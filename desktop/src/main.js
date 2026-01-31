// Safe Tauri invoke - works in both browser (mock) and native app
const invoke = (() => {
  if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core) {
    return window.__TAURI__.core.invoke;
  }
  // Mock for browser development
  return async (cmd, args) => {
    console.warn(`[MOCK] Tauri command not available in browser: ${cmd}`, args);
    throw new Error(`Tauri command '${cmd}' not available in browser environment`);
  };
})();

// Initialize notes array
let notes = [];
let selectedNoteId = null;
let lastInputAt = Date.now();
let isDirty = false;
let syncStatus = "Ready";

// Configure marked (loaded from CDN)
if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
  marked.setOptions({
    highlight: function (code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (e) {
          console.error('Highlighting error:', e);
        }
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
  });
  console.log("✅ Code highlighting enabled");
} else {
  console.warn("⚠️ marked or hljs not loaded from CDN");
}

const noteListEl = document.getElementById("note-list");
const titleInput = document.getElementById("note-title");
const contentInput = document.getElementById("note-content");
const checklistContainer = document.getElementById("checklist-container");
const editorBody = document.getElementById("editor-body");
const pinBtn = document.getElementById("pin-btn");
const deleteBtn = document.getElementById("delete-btn");
const addBtn = document.getElementById("add-btn");
const listToggleBtn = document.getElementById("list-toggle");
const aiBtn = document.getElementById("ai-improve");
const statusEl = document.getElementById("sync-status");
const colorPickerEl = document.getElementById("color-picker");
const titlebarEl = document.getElementById("titlebar");
const emptyStateEl = document.getElementById("empty-state");
const editorPane = document.getElementById("editor-pane");
const emptyAddBtn = document.getElementById("empty-add-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const closeSettingsBtn = document.getElementById("close-settings");
const saveSettingsBtn = document.getElementById("save-settings");
const apiKeyInput = document.getElementById("api-key-input");
const debugLogsEl = document.getElementById("debug-logs");
const commandPalette = document.getElementById("command-palette");
const commandList = document.getElementById("command-list");

const COLORS = ["#ffffff", "#fff9c4", "#ffccbc", "#c8e6c9", "#bbdefb", "#e1bee7"];

// Command Registry
const COMMANDS = [
  { id: 'code', trigger: 'code', label: '@code', description: 'Insert code block', icon: '📝' },
  { id: 'file', trigger: 'file', label: '@file', description: 'Browse files', icon: '📁' }
];

// Command Palette State
let commandPaletteState = {
  isOpen: false,
  selectedIndex: 0,
  filteredCommands: [],
  triggerPos: null
};

// Global Error Handling
window.onerror = (msg, url, line, col, error) => {
  logDebug(`JS Error: ${msg} (at ${line}:${col})`, "error");
  console.error(error);
};

async function init() {
  console.log("Initializing AppNotas UI...");

  // Setup UI components FIRST so buttons work immediately
  setupEventListeners();
  renderColorPicker();
  updateVisibility();

  // Clean up old preview on fresh load
  const oldPreview = document.getElementById("markdown-preview");
  if (oldPreview) oldPreview.remove();

  await loadNotes();
  if (notes.length > 0) {
    selectedNoteId = notes[0].id;
    renderSidebar();
    renderEditor();
  } else {
    updateVisibility();
  }

  setInterval(checkSync, 10000);
}

function renderColorPicker() {
  const colorPickerEl = document.getElementById('color-picker');
  if (!colorPickerEl) return;

  colorPickerEl.innerHTML = COLORS.map(color => `
    <div class="color-circle" data-color="${color}" style="background: ${color}"></div>
  `).join('');

  // Add click handlers
  colorPickerEl.querySelectorAll('.color-circle').forEach(circle => {
    circle.onclick = async () => {
      if (!selectedNoteId) return;
      const note = notes.find(n => n.id === selectedNoteId);
      if (note) {
        note.color = circle.dataset.color;
        await saveCurrentNote();
        renderEditor();
        renderSidebar();
      }
    };
  });
}

async function loadNotes() {
  try {
    logDebug("Loading notes from database...", "info");
    await refreshNotes();

    if (!selectedNoteId && notes.length > 0) {
      selectedNoteId = notes[0].id;
      renderSidebar();
      renderEditor();
    }
    logDebug("App initialized successfully.", "success");
  } catch (err) {
    console.error("Data load error:", err);
    logDebug(`Failed to load data: ${err}`, "error");
  }
}

async function refreshNotes() {
  try {
    notes = await invoke("list_notes");
    notes.sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
      return b.updated_at - a.updated_at;
    });
    renderSidebar();
  } catch (err) {
    console.error("Failed to list notes", err);
    throw err;
  }
}

function updateVisibility() {
  const hasSelection = !!selectedNoteId;
  editorPane.style.display = hasSelection ? "flex" : "none";
  emptyStateEl.style.display = hasSelection ? "none" : "flex";
}

function renderSidebar() {
  noteListEl.innerHTML = "";
  notes.forEach(note => {
    const item = document.createElement("div");
    item.className = `note-item ${note.id === selectedNoteId ? 'active' : ''}`;
    item.innerHTML = `
      <div class="note-item-title">${note.title || "Untitled"} ${note.pinned ? "📌" : ""}</div>
      <div class="note-item-preview">${getPreview(note)}</div>
    `;
    item.onclick = async () => {
      if (isDirty) await saveCurrentNote();
      selectedNoteId = note.id;
      renderSidebar();
      renderEditor();
    };
    noteListEl.appendChild(item);
  });
  updateVisibility();
}

function getPreview(note) {
  if (!note.content) return "No content";
  if (note.is_list) {
    const items = parseChecklist(note.content);
    const item = items[0];
    if (!item) return "Empty list";
    return (item.checked ? "✓ " : "☐ ") + item.text;
  }
  return note.content;
}

// ========== CONTENT ABSTRACTION LAYER ==========
// These functions abstract getting/setting content to support both plain text
// and rich components (code blocks, file browsers, etc.)

function getContent() {
  // Serialize: Convert rich HTML components back to [CODE:...] format
  const content = contentInput.innerHTML;

  // Replace code block components with markers
  const serialized = content.replace(/<div class="code-block-component"[^>]*data-lang="([^"]*)"[^>]*data-code="([^"]*)"[^>]*>[\s\S]*?<\/div>/g,
    (match, lang, code) => {
      const decodedCode = code.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return `\n[CODE:${lang}]\n${decodedCode}\n[/CODE]\n`;
    }
  );

  // Extract plain text from remaining HTML
  const temp = document.createElement('div');
  temp.innerHTML = serialized;
  return temp.textContent || '';
}

function setContent(plainText) {
  // Parse: Convert [CODE:...] markers to rich HTML components
  const parts = [];
  let lastIndex = 0;
  const codeBlockRegex = /\[CODE:(\w+)\]([\s\S]*?)\[\/CODE\]/g;
  let match;

  while ((match = codeBlockRegex.exec(plainText)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const textBefore = plainText.substring(lastIndex, match.index);
      parts.push(createTextNode(textBefore));
    }

    // Add code block component
    const lang = match[1];
    const code = match[2].trim();
    parts.push(createCodeBlockComponent(lang, code));

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < plainText.length) {
    parts.push(createTextNode(plainText.substring(lastIndex)));
  }

  // Render all parts
  contentInput.innerHTML = parts.join('');
}

function createTextNode(text) {
  // Escape HTML and preserve line breaks
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function createCodeBlockComponent(lang, code) {
  const lines = code.split('\n');
  const lineNumbers = lines.map((_, i) => i + 1).join('\n');

  // Highlight code
  let highlightedCode;
  try {
    if (typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
      highlightedCode = hljs.highlight(code, { language: lang }).value;
    } else {
      highlightedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  } catch (e) {
    highlightedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Encode code for data attribute
  const encodedCode = code
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `
    <div class="code-block-component" contenteditable="false" data-lang="${lang}" data-code="${encodedCode}">
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-block-language">${lang}</span>
          <div class="code-block-actions">
            <button class="code-block-copy" onclick="copyCodeBlock(this)">📋 Copy</button>
            <button class="code-block-delete" onclick="deleteCodeBlock(this)">🗑️</button>
          </div>
        </div>
        <div class="code-block-content">
          <pre class="code-block-line-numbers">${lineNumbers}</pre>
          <pre class="code-block-code" contenteditable="true" spellcheck="false" onblur="saveCodeEdit(this)" oninput="updateLineNumbers(this)">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
      </div>
    </div>
  `;
}

function renderEditor() {
  const note = notes.find(n => n.id === selectedNoteId);
  if (!note) {
    updateVisibility();
    return;
  }

  titleInput.value = note.title;
  pinBtn.innerText = note.pinned ? "📌" : "📍";
  listToggleBtn.innerText = note.is_list ? "📝" : "☑";

  const editorEl = document.querySelector(".editor");
  editorEl.style.backgroundColor = `${note.color}cc`;

  if (note.is_list) {
    contentInput.style.display = "none";
    checklistContainer.style.display = "flex";
    hideMarkdownPreview();
    renderChecklist(note);
  } else {
    checklistContainer.style.display = "none";

    // Check if note contains code blocks (markdown fences)
    const hasCodeBlocks = note.content.includes('```');

    if (hasCodeBlocks) {
      // Render mode: Show syntax-highlighted markdown
      contentInput.style.display = "none";
      showMarkdownPreview(note.content);
    } else {
      // Edit mode: Show plain textarea
      contentInput.style.display = "block";
      hideMarkdownPreview();
      setContent(note.content);
    }
  }

  document.querySelectorAll(".color-circle").forEach(circle => {
    circle.classList.toggle("active", circle.dataset.color === note.color);
  });
  updateVisibility();
}

function parseChecklist(content) {
  const lines = (content || '').split('\n');
  return lines.map((raw, idx) => {
    const mChecked = /^\s*\[x\]\s*/i.exec(raw);
    const mUnchecked = /^\s*\[\s?\]\s*/.exec(raw);
    if (mChecked) return { id: idx, checked: true, text: raw.slice(mChecked[0].length) };
    if (mUnchecked) return { id: idx, checked: false, text: raw.slice(mUnchecked[0].length) };
    return { id: idx, checked: false, text: raw };
  });
}

function showMarkdownPreview(content) {
  let previewEl = document.getElementById("markdown-preview");

  // Create preview element if it doesn't exist
  if (!previewEl) {
    previewEl = document.createElement("div");
    previewEl.id = "markdown-preview";
    previewEl.className = "editor-content";
    previewEl.style.padding = "16px";
    previewEl.style.overflowY = "auto";
    previewEl.style.userSelect = "text";
    editorBody.appendChild(previewEl);
  }

  // First, render custom code blocks
  let processedContent = renderCodeBlocks(content);

  // Then process @code shorthand (convert to markdown code blocks)
  processedContent = processedContent.replace(/@code\s+(\w+)\n([\s\S]*?)(?=\n@|$)/g, (match, lang, code) => {
    return `\`\`\`${lang}\n${code.trim()}\n\`\`\``;
  });

  previewEl.style.display = "block";
  previewEl.innerHTML = marked.parse(processedContent);

  // Re-highlight any standard markdown code blocks
  previewEl.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });
}

function hideMarkdownPreview() {
  const previewEl = document.getElementById("markdown-preview");
  if (previewEl) previewEl.style.display = "none";
}

function renderChecklist(note) {
  checklistContainer.innerHTML = "";
  const items = parseChecklist(note.content);

  items.forEach((item, idx) => {
    const el = document.createElement("div");
    el.className = `checklist-item ${item.checked ? 'checked' : ''}`;
    el.innerHTML = `
      <input type="checkbox" class="checklist-checkbox" ${item.checked ? 'checked' : ''}>
      <input type="text" class="checklist-text" value="${item.text}" placeholder="List item...">
    `;

    const checkbox = el.querySelector(".checklist-checkbox");
    const textInput = el.querySelector(".checklist-text");

    checkbox.onchange = () => toggleItem(note, idx);
    textInput.oninput = () => updateItemText(note, idx, textInput.value);

    checklistContainer.appendChild(el);
  });

  const addEl = document.createElement("div");
  addEl.className = "checklist-item";
  addEl.innerHTML = `
    <span style="width: 18px; text-align: center; opacity: 0.5;">+</span>
    <input type="text" class="checklist-text" placeholder="Add item...">
  `;
  addEl.querySelector(".checklist-text").onkeydown = (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      e.preventDefault();
      addItem(note, e.target.value);
    }
  };
  checklistContainer.appendChild(addEl);

  if (note._focusLast) {
    delete note._focusLast;
    const inputs = checklistContainer.querySelectorAll(".checklist-text");
    if (inputs.length > 0) {
      inputs[inputs.length - 1].focus();
    }
  }
}

async function toggleItem(note, index) {
  const items = parseChecklist(note.content);
  items[index].checked = !items[index].checked;
  note.content = items.map(i => i.checked ? `[x] ${i.text}` : `[ ] ${i.text}`).join('\n');
  await saveCurrentNote();
  renderEditor();
}

async function updateItemText(note, index, text) {
  const items = parseChecklist(note.content);
  items[index].text = text;
  note.content = items.map(i => i.checked ? `[x] ${i.text}` : `[ ] ${i.text}`).join('\n');
  onInput();
}

async function addItem(note, text) {
  const prefix = "[ ] ";
  note.content = (note.content ? note.content + "\n" : "") + prefix + text;
  note._focusLast = true;
  await saveCurrentNote();
  renderEditor();
}

async function saveCurrentNote() {
  if (!selectedNoteId) return;
  const note = notes.find(n => n.id === selectedNoteId);
  if (!note) return;

  note.title = titleInput.value;
  if (!note.is_list) note.content = getContent();
  note.updated_at = Math.floor(Date.now() / 1000);

  updateStatus("💾 Saving...");
  try {
    await invoke("save_note", { note });
    isDirty = false;
    updateStatus("✨ Saved locally");
  } catch (err) {
    updateStatus("❌ Error saving");
    console.error(err);
  }
}

function updateStatus(msg) {
  statusEl.innerText = msg;
}

// Global Hotkeys
window.addEventListener("keydown", async (e) => {
  // Command Palette Navigation (highest priority when open)
  if (commandPaletteState.isOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateCommandPalette('down');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateCommandPalette('up');
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const { filteredCommands, selectedIndex } = commandPaletteState;
      if (filteredCommands[selectedIndex]) {
        selectCommand(filteredCommands[selectedIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideCommandPalette();
      return;
    }
  }

  // Color shortcuts (Ctrl+1-6)
  if (e.ctrlKey && e.key >= "1" && e.key <= "6") {
    e.preventDefault();
    if (!selectedNoteId) return;
    const color = COLORS[parseInt(e.key) - 1];
    if (color) {
      const note = notes.find(n => n.id === selectedNoteId);
      note.color = color;
      await saveCurrentNote();
      renderEditor();
    }
  }

  if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    toggleListMode();
  }

  if (e.ctrlKey && e.key.toLowerCase() === "i") {
    e.preventDefault();
    aiBtn.click();
  }

  // Ctrl+P: Toggle color picker visibility
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    if (!selectedNoteId) return;

    const colorPicker = document.getElementById('color-picker');
    const currentDisplay = window.getComputedStyle(colorPicker).display;

    if (currentDisplay === 'none') {
      colorPicker.style.display = 'flex';
      logDebug("Color picker shown", "info");
    } else {
      colorPicker.style.display = 'none';
      logDebug("Color picker hidden", "info");
    }
  }

  // Ctrl+Shift+V: Toggle preview mode (VS Code style)
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    if (!selectedNoteId) return;
    const note = notes.find(n => n.id === selectedNoteId);
    if (!note || note.is_list) return;

    // Toggle between edit and preview
    const hasPreview = document.getElementById("markdown-preview")?.style.display === "block";
    if (hasPreview) {
      // Switch to edit mode
      hideMarkdownPreview();
      contentInput.style.display = "block";
      setContent(note.content);
      contentInput.focus();
      logDebug("Edit mode", "info");
    } else {
      // Switch to preview mode (if has code blocks)
      if (note.content.includes('```') || note.content.includes('@code')) {
        contentInput.style.display = "none";
        showMarkdownPreview(note.content);
        logDebug("Preview mode", "info");
      }
    }
  }

  // Quick Create Shortcuts
  if (e.ctrlKey) {
    // Ctrl + N: New blank note
    if (!e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      createNewNote({ type: 'blank' });
      return;
    }

    // Ctrl + Shift + N: New checklist
    if (e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      createNewNote({ type: 'checklist' });
      return;
    }

    // Ctrl + Shift + C: New code note
    if (e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      createNewNote({ type: 'code' });
      return;
    }

    // Ctrl + Shift + D: New drawing (placeholder)
    if (e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      createNewNote({ type: 'drawing' });
      return;
    }
  }

  // Arrow key navigation (↑/↓ to switch notes)
  if (!e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    // Don't interfere if user is typing in an input field
    const activeElement = document.activeElement;
    const isTyping = activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.classList.contains("checklist-text");

    if (isTyping) return;

    e.preventDefault();

    if (notes.length === 0) return;

    const currentIndex = notes.findIndex(n => n.id === selectedNoteId);
    let newIndex;

    if (e.key === "ArrowUp") {
      // Move to previous note, wrap to bottom if at top
      newIndex = currentIndex <= 0 ? notes.length - 1 : currentIndex - 1;
    } else {
      // Move to next note, wrap to top if at bottom
      newIndex = currentIndex >= notes.length - 1 ? 0 : currentIndex + 1;
    }

    const newNote = notes[newIndex];
    if (newNote) {
      if (isDirty) await saveCurrentNote();
      selectedNoteId = newNote.id;
      renderSidebar();
      renderEditor();
      logDebug(`Navigated to: ${newNote.title}`, "info");
    }
  }
});

async function createNewNote(options = {}) {
  const { type = 'blank' } = options;

  // Save current note if dirty
  if (isDirty) await saveCurrentNote();

  // Create note object
  const newNote = {
    id: crypto.randomUUID(),
    title: "New Note",
    content: "",
    color: "#ffffff",
    pinned: false,
    is_list: false,
    updated_at: Math.floor(Date.now() / 1000)
  };

  // Set defaults based on type
  switch (type) {
    case 'checklist':
      newNote.is_list = true;
      newNote.title = "New Checklist";
      newNote.content = "[ ] First item";
      break;

    case 'code':
      newNote.title = "New Code Snippet";
      newNote.content = "@code javascript\n// Your code here\n";
      break;

    case 'drawing':
      newNote.title = "New Drawing";
      newNote.content = "🖊 Drawing feature coming soon!";
      break;

    default:
      // blank note - keep defaults
      break;
  }

  // Save to database
  try {
    await invoke("save_note", { note: newNote });
    selectedNoteId = newNote.id;
    await refreshNotes();
    renderEditor();
    renderSidebar();

    // Auto-focus title for immediate editing
    setTimeout(() => {
      titleInput.focus();
      titleInput.select();
    }, 100);

    logDebug(`Created new ${type} note`, "success");
  } catch (err) {
    logDebug(`Failed to create note: ${err}`, "error");
  }
}

async function toggleListMode() {
  if (!selectedNoteId) return;
  const note = notes.find(n => n.id === selectedNoteId);

  logDebug("=== CHECKLIST TOGGLE START ===", "info");
  logDebug(`Current mode: ${note.is_list ? 'CHECKLIST' : 'NOTE'}`, "info");
  logDebug(`Content before: "${note.content.substring(0, 100)}..."`, "info");

  // CAPTURE current content before toggling
  if (!note.is_list) {
    // Switching FROM note TO checklist - grab textarea content
    note.content = getContent();
    logDebug(`Captured ${note.content.length} chars from textarea`, "info");
  } else {
    // Switching FROM checklist TO note - grab ALL checklist items
    const inputs = checklistContainer.querySelectorAll(".checklist-text");
    const checks = checklistContainer.querySelectorAll(".checklist-checkbox");
    const lines = [];

    logDebug(`Found ${inputs.length} input fields`, "info");

    // Capture all items INCLUDING the last one
    for (let i = 0; i < inputs.length; i++) {
      const text = inputs[i].value.trim();
      const placeholder = inputs[i].placeholder;

      logDebug(`Field ${i}: "${text}" (placeholder: "${placeholder}")`, "info");

      // Skip ONLY if it's truly empty or is the actual placeholder text
      if (text && text !== "Add item..." && text !== "List item...") {
        const isChecked = checks[i] && checks[i].checked;
        const line = isChecked ? `[x] ${text}` : `[ ] ${text}`;
        lines.push(line);
        logDebug(`  ✓ Saved: "${line}"`, "success");
      } else {
        logDebug(`  ✗ Skipped (empty/placeholder)`, "dim");
      }
    }

    note.content = lines.join('\n');
    logDebug(`Total captured: ${lines.length} items`, lines.length > 0 ? "success" : "error");
  }

  // Toggle the mode
  note.is_list = !note.is_list;
  logDebug(`Toggled to: ${note.is_list ? 'CHECKLIST' : 'NOTE'}`, "info");

  // Format content for the NEW mode
  if (note.is_list) {
    // Converting TO checklist - add [ ] markers
    const lines = note.content.split('\n');
    note.content = lines.map(l => {
      const trimmed = l.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("[ ]") || trimmed.startsWith("[x]")) return trimmed;
      return `[ ] ${trimmed}`;
    }).filter(l => l !== "").join('\n');
    logDebug(`Formatted to checklist: ${note.content.split('\n').length} items`, "info");
  } else {
    // Converting TO note - remove [ ] markers, keep checkmarks as ✓
    const items = parseChecklist(note.content);
    note.content = items.map(i => i.checked ? `${i.text} ✓` : i.text).join('\n');
    logDebug(`Formatted to note: "${note.content.substring(0, 100)}..."`, "info");

    // CRITICAL FIX: Update the textarea BEFORE saving
    // Otherwise saveCurrentNote() will read the old/empty textarea value
    setContent(note.content);
    logDebug("✓ Updated textarea with formatted content", "success");
  }

  logDebug("=== TOGGLE COMPLETE ===", "success");

  await saveCurrentNote();
  renderEditor();
  renderSidebar();
}

function onInput() {
  lastInputAt = Date.now();
  isDirty = true;
  updateStatus("✍️ Waiting...");
  const note = notes.find(n => n.id === selectedNoteId);
  if (note) {
    note.title = titleInput.value;
    if (!note.is_list) note.content = getContent();
  }
}

function logDebug(msg, type = "info") {
  const span = document.createElement("div");
  span.className = type;
  const time = new Date().toLocaleTimeString();
  span.innerText = `[${time}] ${msg}`;
  if (debugLogsEl.querySelector(".dim")) debugLogsEl.innerHTML = "";
  debugLogsEl.prepend(span);
}

async function checkSync() {
  if (isDirty && (Date.now() - lastInputAt > 10000)) {
    await saveCurrentNote();
    renderSidebar();
  }
}

// ========== COMMAND PALETTE FUNCTIONS ==========

function showCommandPalette(query = '') {
  commandPaletteState.filteredCommands = COMMANDS.filter(cmd =>
    cmd.trigger.toLowerCase().includes(query.toLowerCase())
  );

  commandPaletteState.selectedIndex = 0;
  renderCommandPalette();
  positionCommandPalette();

  commandPalette.style.display = 'block';
  setTimeout(() => commandPalette.classList.add('visible'), 10);
  commandPaletteState.isOpen = true;
}

function hideCommandPalette() {
  commandPalette.classList.remove('visible');
  setTimeout(() => {
    commandPalette.style.display = 'none';
    commandPaletteState.isOpen = false;
    commandPaletteState.triggerPos = null;
  }, 200);
}

function renderCommandPalette() {
  const { filteredCommands, selectedIndex } = commandPaletteState;

  if (filteredCommands.length === 0) {
    commandList.innerHTML = '<div class="command-empty">No commands found</div>';
    return;
  }

  commandList.innerHTML = filteredCommands.map((cmd, idx) => `
    <div class="command-item ${idx === selectedIndex ? 'selected' : ''}" data-index="${idx}">
      <span class="icon">${cmd.icon}</span>
      <div class="info">
        <div class="label">${cmd.label}</div>
        <div class="description">${cmd.description}</div>
      </div>
      <span class="trigger">@${cmd.trigger}</span>
    </div>
  `).join('');

  // Add click handlers
  commandList.querySelectorAll('.command-item').forEach(item => {
    item.onclick = () => {
      const index = parseInt(item.dataset.index);
      selectCommand(filteredCommands[index]);
    };
  });
}

function positionCommandPalette() {
  const textarea = contentInput;
  const { selectionStart } = textarea;

  // Simple positioning: below the textarea, aligned left
  const rect = textarea.getBoundingClientRect();
  commandPalette.style.left = rect.left + 'px';
  commandPalette.style.top = (rect.top + 24) + 'px';
}

function selectCommand(command) {
  if (command.action) {
    command.action();
  } else if (command.id === 'code') {
    insertCodeBlock();
  } else if (command.id === 'file') {
    insertFileBrowser();
  }

  // CRITICAL: Hide the palette after selection
  hideCommandPalette();
}

function navigateCommandPalette(direction) {
  const { filteredCommands, selectedIndex } = commandPaletteState;

  if (direction === 'down') {
    commandPaletteState.selectedIndex = Math.min(selectedIndex + 1, filteredCommands.length - 1);
  } else if (direction === 'up') {
    commandPaletteState.selectedIndex = Math.max(selectedIndex - 1, 0);
  }

  renderCommandPalette();
}

function insertCodeBlock() {
  // Get current selection/cursor position
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);

  // Get all text before cursor
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(contentInput);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  const textBefore = preCaretRange.toString();

  // Find @ position
  const atIndex = textBefore.lastIndexOf('@');

  if (atIndex === -1) {
    logDebug("No @ found", "error");
    return;
  }

  // Get text before and after @
  const before = textBefore.substring(0, atIndex);
  const after = getContent().substring(textBefore.length);

  // Insert code block (default to plaintext)
  const codeBlock = `\n[CODE:plaintext]\n// Your code here\n[/CODE]\n`;
  const newContent = before + codeBlock + after;

  setContent(newContent);

  // Wait for render, then focus the code block
  setTimeout(() => {
    const codeBlocks = contentInput.querySelectorAll('.code-block-code');
    if (codeBlocks.length > 0) {
      const lastCodeBlock = codeBlocks[codeBlocks.length - 1];
      lastCodeBlock.focus();

      // Select all placeholder text for easy replacement
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(lastCodeBlock);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, 50);

  // Update note
  const note = notes.find(n => n.id === selectedNoteId);
  if (note) {
    note.content = newContent;
    saveCurrentNote();
  }

  logDebug("Code block inserted", "success");
}

function renderCodeBlocks(content) {
  // Convert [CODE:lang]...[/CODE] to styled HTML
  return content.replace(/\[CODE:(\w+)\]([\s\S]*?)\[\/CODE\]/g, (match, lang, code) => {
    // Clean up the code (remove leading/trailing newlines)
    code = code.trim();

    const lines = code.split('\n');
    const lineNumbers = lines.map((_, i) => i + 1).join('\n');

    // Highlight code using hljs
    let highlightedCode;
    try {
      if (hljs.getLanguage(lang)) {
        highlightedCode = hljs.highlight(code, { language: lang }).value;
      } else {
        highlightedCode = hljs.highlightAuto(code).value;
      }
    } catch (e) {
      highlightedCode = code; // Fallback to plain text
    }

    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-block-language">${lang}</span>
          <button class="code-block-copy" onclick="copyCodeBlock(this)" data-code="${code.replace(/"/g, '&quot;')}">📋 Copy</button>
        </div>
        <div class="code-block-content">
          <pre class="code-block-line-numbers">${lineNumbers}</pre>
          <pre class="code-block-code"><code>${highlightedCode}</code></pre>
    `;
  });
}

window.copyCodeBlock = function (button) {
  const component = button.closest('.code-block-component');
  const code = component.dataset.code.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  navigator.clipboard.writeText(code).then(() => {
    const originalText = button.textContent;
    button.textContent = '✓ Copied!';
    button.style.background = 'rgba(99, 241, 164, 0.2)';
    button.style.color = '#63f1a4';
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = '';
      button.style.color = '';
    }, 2000);
  }).catch(err => {
    console.error('Copy failed:', err);
  });
};

window.editCodeBlock = function (button) {
  const component = button.closest('.code-block-component');
  const lang = component.dataset.lang;
  const code = component.dataset.code.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  // Create simple prompt for now (later can be a modal)
  const newCode = prompt(`Edit ${lang} code:`, code);

  if (newCode !== null) {
    // Update the component
    component.dataset.code = newCode.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Re-render the component
    const wrapper = component.querySelector('.code-block-wrapper');
    const lines = newCode.split('\n');
    const lineNumbers = lines.map((_, i) => i + 1).join('\n');

    let highlightedCode;
    try {
      if (typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
        highlightedCode = hljs.highlight(newCode, { language: lang }).value;
      } else {
        highlightedCode = newCode.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    } catch (e) {
      highlightedCode = newCode.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const codeContent = wrapper.querySelector('.code-block-content');
    codeContent.innerHTML = `
      <pre class="code-block-line-numbers">${lineNumbers}</pre>
      <pre class="code-block-code"><code>${highlightedCode}</code></pre>
    `;

    // Save changes
    const note = notes.find(n => n.id === selectedNoteId);
    if (note) {
      note.content = getContent();
      saveCurrentNote();
    }
  }
};

let deleteTarget = null;

window.deleteCodeBlock = function (button) {
  deleteTarget = button.closest('.code-block-component');
  document.getElementById('delete-modal').style.display = 'flex';
};

window.closeDeleteModal = function () {
  document.getElementById('delete-modal').style.display = 'none';
  deleteTarget = null;
};

window.saveCodeEdit = function (codeElement) {
  const component = codeElement.closest('.code-block-component');
  // Use innerText to preserve newlines correctly
  const newCode = codeElement.innerText;

  // Update dataset
  component.dataset.code = newCode
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Update line numbers
  const lines = newCode.split('\n');
  const lineNumbers = lines.map((_, i) => i + 1).join('\n');
  const lineNumEl = component.querySelector('.code-block-line-numbers');
  if (lineNumEl) {
    lineNumEl.textContent = lineNumbers;
  }

  // Save to backend
  const note = notes.find(n => n.id === selectedNoteId);
  if (note) {
    note.content = getContent();
    saveCurrentNote();
  }
};

window.updateLineNumbers = function (codeElement) {
  const component = codeElement.closest('.code-block-component');
  const code = codeElement.innerText;
  const lines = code.split('\n');
  const lineNumbers = lines.map((_, i) => i + 1).join('\n');
  const lineNumEl = component.querySelector('.code-block-line-numbers');
  if (lineNumEl) {
    lineNumEl.textContent = lineNumbers;
  }
};

function setupEventListeners() {
  titleInput.oninput = onInput;

  contentInput.oninput = () => {
    onInput();

    // Command palette: detect @ trigger
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(contentInput);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const textBefore = preCaretRange.toString();

    const lastAtIndex = textBefore.lastIndexOf('@');

    // Check if @ is recent and not part of an old command
    if (lastAtIndex !== -1) {
      const textAfterAt = textBefore.substring(lastAtIndex + 1);
      // Only trigger if there's no space after @ (still typing command)
      if (!textAfterAt.includes(' ') && textAfterAt.length < 20) {
        showCommandPalette(textAfterAt);
        return;
      }
    }

    // Hide palette if @ condition not met
    if (commandPaletteState.isOpen) {
      hideCommandPalette();
    }
  };

  titlebarEl.onmousedown = async (e) => {
    if (e.target === titlebarEl || e.target.classList.contains('brand')) {
      await invoke("drag_window");
    }
  };

  const createNote = async () => {
    if (isDirty) await saveCurrentNote();
    const newNote = {
      id: crypto.randomUUID(),
      title: "New Note",
      content: "",
      color: "#ffffff",
      pinned: false,
      is_list: false,
      updated_at: Math.floor(Date.now() / 1000)
    };
    try {
      await invoke("save_note", { note: newNote });
      selectedNoteId = newNote.id;
      await refreshNotes();
      renderEditor();
      renderSidebar();
    } catch (err) {
      logDebug(`Failed to create note: ${err}`, "error");
    }
  };

  addBtn.onclick = createNote;
  emptyAddBtn.onclick = createNote;

  deleteBtn.onclick = async () => {
    if (!selectedNoteId) return;

    const note = notes.find(n => n.id === selectedNoteId);
    // Update modal text for note deletion
    const modal = document.getElementById('delete-modal');
    modal.querySelector('h3').textContent = 'Delete Note?';
    modal.querySelector('p').textContent = `"${note.title || 'Untitled'}" will be permanently deleted.`;

    // Store noteID for deletion
    deleteTarget = selectedNoteId;
    modal.style.display = 'flex';
  };

  pinBtn.onclick = async () => {
    if (!selectedNoteId) return;
    const note = notes.find(n => n.id === selectedNoteId);
    note.pinned = !note.pinned;
    try {
      await saveCurrentNote();
      await refreshNotes();
      renderSidebar();
    } catch (err) {
      logDebug(`Failed to pin note: ${err}`, "error");
    }
  };

  listToggleBtn.onclick = toggleListMode;

  aiBtn.onclick = async () => {
    if (!selectedNoteId) return;
    const note = notes.find(n => n.id === selectedNoteId);
    updateStatus("🧠 Thinking...");
    logDebug("Sending AI request...", "info");
    aiBtn.disabled = true;

    try {
      const improved = await invoke("improve_note", { content: note.content });

      // Show preview modal
      const aiPreviewModal = document.getElementById("ai-preview-modal");
      const aiOriginalText = document.getElementById("ai-original-text");
      const aiImprovedText = document.getElementById("ai-improved-text");

      aiOriginalText.textContent = note.content;
      aiImprovedText.textContent = improved;
      aiPreviewModal.classList.add("open");
      aiPreviewModal.style.display = "flex";

      // Store the improved version temporarily
      aiPreviewModal.dataset.improvedContent = improved;
      aiPreviewModal.dataset.targetNoteId = selectedNoteId;

      updateStatus("✨ Preview Ready");
      logDebug("AI improvement ready for review.", "success");
    } catch (err) {
      updateStatus("❌ AI Error");
      logDebug(`AI Error: ${err}`, "error");
    } finally {
      aiBtn.disabled = false;
    }
  };

  settingsBtn.onclick = async () => {
    const isOpen = settingsModal.classList.contains("open");

    if (isOpen) {
      settingsModal.classList.remove("open");
      return;
    }

    settingsModal.classList.add("open");
    settingsModal.style.display = "flex"; // Ensure it's visible for animation

    try {
      const key = await invoke("get_api_key");
      apiKeyInput.value = key || "";
    } catch (err) {
      logDebug(`Failed to load API key: ${err}`, "error");
    }
  };

  closeSettingsBtn.onclick = () => {
    settingsModal.classList.remove("open");
  };

  settingsModal.onclick = (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove("open");
    }
  };

  saveSettingsBtn.onclick = async () => {
    const key = apiKeyInput.value.trim();
    try {
      await invoke("set_api_key", { key });
      logDebug("API Key saved successfully.", "success");
      settingsModal.classList.remove("open");
    } catch (err) {
      logDebug(`Failed to save API key: ${err}`, "error");
    }
  };

  // Copy logs button
  const copyLogsBtn = document.getElementById("copy-logs-btn");
  if (copyLogsBtn) {
    copyLogsBtn.onclick = () => {
      const logsText = debugLogsEl.innerText;
      navigator.clipboard.writeText(logsText).then(() => {
        copyLogsBtn.innerText = "Copied!";
        setTimeout(() => { copyLogsBtn.innerText = "Copy"; }, 2000);
      }).catch(err => {
        console.error("Failed to copy:", err);
      });
    };
  }

  // AI Preview Modal handlers
  const aiPreviewModal = document.getElementById("ai-preview-modal");
  const aiAcceptBtn = document.getElementById("ai-accept-btn");
  const aiRejectBtn = document.getElementById("ai-reject-btn");
  const closeAiPreviewBtn = document.getElementById("close-ai-preview");

  aiAcceptBtn.onclick = async () => {
    const improvedContent = aiPreviewModal.dataset.improvedContent;
    const targetNoteId = aiPreviewModal.dataset.targetNoteId;

    const note = notes.find(n => n.id === targetNoteId);
    if (note) {
      note.content = improvedContent;
      if (!note.is_list) setContent(improvedContent);
      await saveCurrentNote();
      renderSidebar();
      renderEditor();
      logDebug("AI improvement accepted and applied.", "success");
      updateStatus("✅ Improved");
    }

    aiPreviewModal.classList.remove("open");
    setTimeout(() => { aiPreviewModal.style.display = "none"; }, 300);
  };

  aiRejectBtn.onclick = () => {
    logDebug("AI improvement rejected.", "info");
    updateStatus("Ready");
    aiPreviewModal.classList.remove("open");
    setTimeout(() => { aiPreviewModal.style.display = "none"; }, 300);
  };

  closeAiPreviewBtn.onclick = () => {
    aiRejectBtn.click();
  };

  // Close modal on backdrop click
  aiPreviewModal.onclick = (e) => {
    if (e.target === aiPreviewModal) {
      aiRejectBtn.click();
    }
  };

  // Delete confirmation modal handler
  const confirmDeleteBtn = document.getElementById("confirm-delete-btn");
  confirmDeleteBtn.onclick = async () => {
    if (!deleteTarget) return;

    // Check if it's a DOM element (code block) or ID (note)
    if (typeof deleteTarget === 'object' && deleteTarget.classList) {
      // Delete code block
      deleteTarget.remove();

      // Force content update to prevent leftover text
      const note = notes.find(n => n.id === selectedNoteId);
      if (note) {
        // Get fresh content after removal
        note.content = getContent();
        await saveCurrentNote();

        // Re-render to ensure consistency
        setContent(note.content);
      }
    } else {
      // Delete note (deleteTarget is note ID)
      try {
        await invoke("delete_note", { id: deleteTarget });
        logDebug(`Note ${deleteTarget} deleted.`, "info");
        notes = notes.filter(n => n.id !== deleteTarget);

        if (selectedNoteId === deleteTarget) {
          selectedNoteId = notes.length > 0 ? notes[0].id : null;
        }

        renderSidebar();
        if (selectedNoteId) {
          renderEditor();
        } else {
          updateVisibility();
        }
      } catch (err) {
        console.error("Delete failed", err);
        logDebug(`Failed to delete note: ${err}`, "error");
      }
    }

    closeDeleteModal();
  };
}


// ========== FILE BROWSER ==========

async function insertFileBrowser() {
  try {
    // Get current selection/cursor position
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);

    // Get all text before cursor
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(contentInput);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const textBefore = preCaretRange.toString();

    // Find @ position
    const atIndex = textBefore.lastIndexOf('@');

    if (atIndex === -1) {
      logDebug('No @ found', 'error');
      return;
    }

    // Get text before and after @
    const before = textBefore.substring(0, atIndex);
    const after = getContent().substring(textBefore.length);

    // Set content without @file text
    setContent(before + after);

    // Wait for render
    await new Promise(resolve => setTimeout(resolve, 50));

    const homeDir = 'C:\\Users\\Utilizador';

    const browserComponent = document.createElement('div');
    browserComponent.className = 'file-browser-component';
    browserComponent.contentEditable = 'false';
    browserComponent.setAttribute('data-current-path', homeDir);

    browserComponent.innerHTML = `
      <div class="file-browser-header">
        <span class="file-browser-icon">📁</span>
        <span class="file-browser-path">${homeDir}</span>
      </div>
      <div class="file-browser-input-container">
        <input type="text" class="file-browser-input" placeholder="cd path or arrow keys to navigate..." />
      </div>
      <div class="file-browser-list">
        <div class="file-browser-loading">Loading...</div>
      </div>
      <div class="file-browser-actions">
        <button class="file-browser-cancel">Cancel</button>
      </div>
    `;

    // Insert at cursor position
    const newRange = window.getSelection().getRangeAt(0);
    newRange.insertNode(browserComponent);
    newRange.collapse(false);

    await loadDirectory(browserComponent, homeDir);

    const input = browserComponent.querySelector('.file-browser-input');
    input.focus();

    setupFileBrowserEvents(browserComponent);

    logDebug('File browser opened', 'success');
  } catch (err) {
    logDebug(`Failed to open file browser: ${err}`, 'error');
  }
}

async function loadDirectory(browserComponent, path) {
  const listEl = browserComponent.querySelector('.file-browser-list');
  listEl.innerHTML = '<div class="file-browser-loading">Loading...</div>';

  try {
    const files = await invoke('list_directory', { path });

    browserComponent.querySelector('.file-browser-path').textContent = path;
    browserComponent.setAttribute('data-current-path', path);

    listEl.innerHTML = '';
    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-browser-item';
      if (index === 0) item.classList.add('selected');
      item.setAttribute('data-path', file.path);
      item.setAttribute('data-is-dir', file.is_dir);

      const icon = file.is_dir ? '📁' : '📄';
      const meta = file.is_dir ? '' : formatFileSize(file.size);

      item.innerHTML = `
        <span class="file-browser-item-icon">${icon}</span>
        <span class="file-browser-item-name">${file.name}</span>
        <span class="file-browser-item-meta">${meta}</span>
      `;

      listEl.appendChild(item);
    });

  } catch (err) {
    listEl.innerHTML = `<div class="file-browser-error">Error: ${err}</div>`;
  }
}

function setupFileBrowserEvents(browserComponent) {
  const input = browserComponent.querySelector('.file-browser-input');
  const listEl = browserComponent.querySelector('.file-browser-list');
  const cancelBtn = browserComponent.querySelector('.file-browser-cancel');

  cancelBtn.onclick = () => browserComponent.remove();

  input.onkeydown = async (e) => {
    if (e.key === 'Enter') {
      const command = input.value.trim();
      if (command.startsWith('cd ')) {
        let newPath = command.substring(3).trim();
        const currentPath = browserComponent.getAttribute('data-current-path');

        if (newPath === '..') {
          const parts = currentPath.split('\\').filter(p => p);
          if (parts.length > 1) parts.pop();
          newPath = parts.join('\\') + '\\';
        }

        await loadDirectory(browserComponent, newPath);
        input.value = '';
      }
    } else if (e.key === 'Escape') {
      browserComponent.remove();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateFileList(listEl, e.key === 'ArrowDown' ? 1 : -1);
    }
  };

  listEl.onclick = async (e) => {
    const item = e.target.closest('.file-browser-item');
    if (!item) return;

    listEl.querySelectorAll('.file-browser-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');

    if (e.detail === 2) {
      const path = item.getAttribute('data-path');
      const isDir = item.getAttribute('data-is-dir') === 'true';

      if (isDir) {
        await loadDirectory(browserComponent, path);
      } else {
        insertFileLink(browserComponent, path);
      }
    }
  };

  const enterHandler = async (e) => {
    if (e.key === 'Enter' && document.activeElement !== input) {
      const selected = listEl.querySelector('.file-browser-item.selected');
      if (selected) {
        const path = selected.getAttribute('data-path');
        const isDir = selected.getAttribute('data-is-dir') === 'true';

        if (isDir) {
          await loadDirectory(browserComponent, path);
        } else {
          insertFileLink(browserComponent, path);
        }
      }
    }
  };

  document.addEventListener('keydown', enterHandler);
  browserComponent._enterHandler = enterHandler;
}

function navigateFileList(listEl, direction) {
  const items = Array.from(listEl.querySelectorAll('.file-browser-item'));
  const currentIndex = items.findIndex(item => item.classList.contains('selected'));

  let newIndex = currentIndex + direction;
  if (newIndex < 0) newIndex = 0;
  if (newIndex >= items.length) newIndex = items.length - 1;

  items.forEach(item => item.classList.remove('selected'));
  items[newIndex].classList.add('selected');
  items[newIndex].scrollIntoView({ block: 'nearest' });
}

function insertFileLink(browserComponent, filePath) {
  if (browserComponent._enterHandler) {
    document.removeEventListener('keydown', browserComponent._enterHandler);
  }
  browserComponent.remove();

  const fileName = filePath.split('\\').pop();
  const linkComponent = document.createElement('div');
  linkComponent.className = 'file-link-component';
  linkComponent.contentEditable = 'false';
  linkComponent.setAttribute('data-file-path', filePath);

  linkComponent.innerHTML = `
    📄 <span class="file-link-name">${fileName}</span>
    <button class="file-link-open" onclick="openFileExternal('${filePath.replace(/\\/g, '\\\\')}')">Open</button>
    <button class="file-link-delete" onclick="this.closest('.file-link-component').remove()">×</button>
  `;

  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  range.insertNode(linkComponent);
  range.collapse(false);

  const note = notes.find(n => n.id === selectedNoteId);
  if (note) {
    note.content = getContent();
    saveCurrentNote();
  }

  logDebug(`File link inserted: ${fileName}`, 'success');
}

window.openFileExternal = async function (filePath) {
  try {
    await invoke('open_file_external', { path: filePath });
    logDebug(`Opened file: ${filePath}`, 'success');
  } catch (err) {
    logDebug(`Failed to open file: ${err}`, 'error');
  }
};

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}


init();
