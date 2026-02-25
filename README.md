# 💎 ONYX Notes

A modular, blazing-fast, local-first note-taking app for privacy, beauty, and deep study. Built with **Tauri**, **React**, **TipTap**, and **Yjs** for collaborative, native-like performance across Windows, macOS, and Linux.

> **Current Version:** `v0.0.2-alpha`

---

## 🚀 Features

### ✨ Core Engine
- **TipTap Editor:** Rich-text editing powered by TipTap 3, with custom extensions and nodes.
- **Hybrid Markdown:** Markdown syntax is hidden while you type, giving a seamless rich-text feel with plain-text portability.
- **Math Support:** Full LaTeX with KaTeX. `$...$` for inline, `$$...$$` for blocks.
- **Smart Lists:** Auto-indenting bullets & numbers.
- **Code Folding:** Collapse headers/sections for focus.

### 🔍 Search
- **Live Indexing:** Zero-latency, strict matching—no fuzzy guessing.
- **Native Highlights:** Matches feel like real text selection.

### 🔒 Security & Privacy
- **Local-First:** Your data stays on your device.
- **AES-256-GCM Encryption:** Lock notes, password-protected at rest.

### 🤝 Real-Time Collaboration
- **Yjs CRDT:** Real-time sync and collaboration, powered by Yjs and Hocuspocus WebSocket server.
- **Offline-first:** Changes sync automatically when online.

### 🎨 UI/UX
- **Discord-inspired Dark Mode**
- **Fluid Tabs:** Browser-grade drag & drop (dnd-kit, FLIP animations).
- **Glassmorphism:** Subtle translucency, smooth transitions.

### 🛠 Infrastructure
- **Auto-Updater:** Background updates, always fresh.
- **Cross-Platform:** Native builds for Windows (`.exe`), macOS (`.dmg`), Linux (`.deb`).

---

## 🗺 Roadmap

- [ ] **Mobile App:** Native Android (tablet/phone)
- [ ] **Encrypted Cloud Sync:** Git/S3/WebDAV
- [ ] **Command Palette:** `Ctrl+Shift+P` for keyboard control
- [ ] **Plugin System:** Community extension API
- [ ] **Export:** PDF & HTML with themes

---

## 🛠️ Setup & Development

### Prerequisites
- [Node.js](https://nodejs.org/) (Latest LTS)
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)

### Quickstart

```bash
git clone https://github.com/Onyx-Void-Labs/onyx.git
cd onyx
npm install
npm run tauri dev
```
*Runs React frontend, TipTap editor, Yjs sync, and Tauri backend with hot reload.*

### Build for Production

```bash
npm run tauri build
```
*Binaries in `src-tauri/target/release/bundle`*

---

## 🤝 Contributing

ONYX is open source and active—issues and PRs welcome!

---

*Created by [Omar Itani](https://github.com/om-itani)*
