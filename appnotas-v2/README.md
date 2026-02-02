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

## 📥 Downloads

**Latest Version: v0.1.0**

| Platform | File |
|----------|------|
| **Windows** | [Download .exe Installer](bundle/AppNotas_0.1.0_x64-setup.exe) |
| **Linux** | [Download .rpm Package](bundle/AppNotas-0.1.0-1.x86_64.rpm) |

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

**Note**: running `package:all` will automatically collect the `.exe` and `.rpm` files into a `bundle/` folder in the project root.

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
