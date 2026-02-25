# ONYX.

A privacy-first, local-first note-taking app for students and deep thinkers.
Built with Tauri, React, and TipTap.

> Currently in alpha. Expect rough edges.

## What it is

Onyx is a desktop note-taking app that tries to be genuinely useful for
studying — not just pretty. It combines a rich-text editor, spaced repetition
flashcards, task management, and real-time collaboration in one offline-first
app that keeps your data on your device.

## Stack

| Layer | Technology |
|---|---|
| Desktop | Tauri v2 (Rust) |
| Frontend | React + TypeScript + Tailwind CSS |
| Editor | TipTap 3 |
| Sync | Yjs + Hocuspocus WebSocket |
| Storage | IndexedDB (local-first) |
| Encryption | AES-256-GCM, PBKDF2 |

## Features

- **Rich text editor** — headings, tables, math (KaTeX), code blocks,
  checklists, callouts, note linking with `+`
- **Flashcard system** — 5 card types (basic, fill-in-blank, MCQ, matching,
  cloze) with FSRS spaced repetition
- **Today dashboard** — tasks due today, overdue, scheduled, and backlog
- **Properties panel** — 18 field types per note (dates, status, relations, etc.)
- **Query views** — list, grid, board, and calendar views per note type
- **Encryption** — lock your vault with a password
- **Real-time collaboration** — Yjs CRDT sync via Hocuspocus

## Getting started

**Prerequisites:** Node.js (LTS), Rust

```bash
git clone https://github.com/Onyx-Void-Labs/onyx.git
cd onyx
npm install
npm run tauri dev
```

**Build for production:**

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/
```

## Project structure

```
onyx/
├── src/                  # React frontend
│   └── components/       # editor, flashcards, layout, modals, etc.
├── src-tauri/            # Rust + Tauri config
├── infrastructure/       # VPS server (Hocuspocus, deploy scripts)
└── docs/                 # Documentation
```

## Status

`v0.0.2-alpha` — core editor and study tools are working.
Active development, not yet ready for daily use.

## License

GPL-3.0 — see [LICENSE](./LICENSE)

---

Created by [Omar Itani](https://github.com/om-itani)
