
# Onyx Infrastructure

This folder contains all server-side, deployment, and collaboration services for Onyx.

- `api/`: REST API server
- `hocuspocus/`: Collaboration WebSocket server
- `deploy/`: Deployment scripts, configs, and systemd files

See each subfolder for details.

```
onyx/
├── apps/
│   ├── desktop/          # Tauri desktop app (Rust + config)
│   └── server/           # Backend servers (API + Hocuspocus)
├── src/                  # Frontend React application
│   ├── components/
│   │   ├── editor/       # TipTap editor + extensions
│   │   ├── flashcards/   # Spaced repetition card system
│   │   ├── layout/       # Sidebar, TabBar, Titlebar
│   │   ├── modals/       # Search, Lock, Settings modals
│   │   ├── properties/   # Note properties panel
│   │   ├── query/        # Collection views + query blocks
│   │   ├── settings/     # Settings tabs
│   │   ├── today/        # Daily dashboard
│   │   └── ui/           # Reusable UI primitives
│   ├── contexts/         # React context providers
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Business logic (flashcards, FSRS, sync)
│   ├── services/         # External service integrations
│   ├── store/            # State management
│   ├── types/            # TypeScript type definitions
│   └── utils/            # Pure utility functions
├── scripts/              # Build & migration scripts
├── public/               # Static assets
└── docs/                 # Documentation
```

## Dev Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)

### Install & Run

```bash
# Clone
git clone https://github.com/om-itani/onyx.git
cd onyx

# Install dependencies
npm install

# Run frontend dev server
npm run dev

# Run desktop app (Tauri)
npm run tauri dev

# Build for production
npm run tauri build
```

### Run Collaboration Server

```bash
cd apps/server/hocuspocus
npm install
node index.js
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Search / Quick Open |
| `Ctrl+N` | New Page |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+U` | Underline |
| `Ctrl+K` | Insert Link |
| `Ctrl+F` | Find & Replace |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+Shift+M` | Module Switcher |
| `/` | Slash Commands |
| `+` | Link to Note |
| **Flashcard Review** | |
| `1` | Again |
| `2` | Hard |
| `3` | Good |
| `4` | Easy |
| `Space` / `Enter` | Flip Card |
| `H` | Show Hint |

## Contributing

ONYX is open source. Feel free to open issues or PRs.

---
*Created by [Omar Itani](https://github.com/om-itani)*
