# 📝 AppNotas v2

A modern, high-performance note-taking application built with **Svelte** and **Tauri**. Featuring a rich-text TipTap editor, AI-assisted writing, and local-first markdown storage.

## ✨ Features

- 🚀 **Native Performance**: Built with Rust/Tauri for a lightweight, fast desktop experience.
- ✍️ **Rich Editor**: Powerful TipTap-based editor with support for Markdown, Task Lists, and Code Blocks.
- 🎨 **Modern UI**: Sleek dark mode with glassmorphism aesthetics and micro-animations.
- 🖼️ **Smart Images**: Draggable, resizable images with dual-corner scaling.
- ✏️ **Drawing Nodes**: Integrated canvas for quick sketches and diagrams.
- 🤖 **AI Support**: Seamlessly integrate with Google Gemini for text generation and improvement.
- 📁 **File-First**: Your notes are saved as human-readable `.md` files on your local machine.
- 🔄 **External-edit aware**: A filesystem watcher refreshes the app when the notes folder is changed by another tool (e.g. a local MCP server or OneDrive sync) — see below.

## 🔌 External editors / MCP integration

The notes folder is a plain directory of Markdown files, so other tools can read and write it directly while AppNotas is running. AppNotas watches the notes directory (and its `tasks/` subfolder) and **auto-refreshes** when files are added, edited, or removed externally — no manual reload needed.

Details and guarantees:

- **Debounced watcher** (~400ms) on the notes directory, recursive. It ignores `.trash/` and other dot-folders, the app's own temp files, non-`.md` files, and OneDrive conflict copies, and suppresses the events from the app's own saves (no feedback loop).
- **In-place refresh:** if a note that's currently open changes on disk and you have **no unsaved edits**, the editor reloads it from disk. If you *do* have unsaved edits, your edits are kept (your next save wins) — the app won't silently discard your work.
- **Non-lossy saves:** when the app saves a note it **preserves `created`, `tags`, and `color`** already in the file's frontmatter (only `modified`, title, body, and an explicitly-changed color are updated). This means metadata set by an external tool is never wiped by an in-app edit.
- **Format contract (kept stable for external tools):** frontmatter starts at byte 0 with `---`, UTF-8 with **no BOM**, keys `title` / `created` / `modified` / `tags: [..]` / optional `color`, body after the closing `---`. Task notes live in the flat `tasks/` subfolder; tasks are checkbox lines `- [ ] text` / `- [x] text` with line-index identity (toggling one line does not reflow the others). `.trash/` is excluded from all listing and search.

## 📥 Downloads

**Latest Version: v0.1.0**

| Platform | File |
|----------|------|
| **Windows** | [Download .exe Installer](https://github.com/y0c0ms/appnotasv2/releases/latest/download/AppNotas_0.1.1_x64-setup.exe) |
| **Linux** | [Download .rpm Package](https://github.com/y0c0ms/appnotasv2/releases/latest/download/AppNotas-0.1.1-1.x86_64.rpm) |

## 🚀 Getting Started

### Development

Ensure you have [Bun](https://bun.sh/) and [Rust](https://rustup.rs/) installed.

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

### Packaging for Distribution

AppNotas uses a unified packaging script for generating production-ready installers.

```bash
# Build for your current platform only
bun run package

# Build for BOTH Windows and Linux (requires WSL)
bun run package:all
```

**Note**: running `package:all` will automatically collect the final `.exe` and `.rpm` files into the `releases/` folder in the project root.

#### Windows (NSIS)
The `.exe` installer will be located at:
`src-tauri/target/release/bundle/nsis/AppNotas_0.1.0_x64-setup.exe`

#### Linux (RPM)
The `.rpm` package will be located at:
`src-tauri/target/release/bundle/rpm/appnotas-0.1.0-1.x86_64.rpm`

## 🛠️ Configuration

AppNotas stores its settings in a local `.settings.json` file. You can configure:
- **Notes Directory**: Where your `.md` files are stored.
- **AI Key**: Your Google Gemini API key.
- **Zoom Level**: Global UI scaling.

## ⚖️ License

MIT License - Copyright (c) 2026 AppNotas Team
