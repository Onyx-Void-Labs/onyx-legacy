# Contributing to Onyx

## Commit Message Convention

We follow a lightweight conventional commit format:

```
<type>: <description>
```

### Types

| Type       | When to use                                    |
|------------|------------------------------------------------|
| `feat`     | Adding a new feature                           |
| `fix`      | Bug fix                                        |
| `chore`    | Maintenance, config changes, dependency updates |
| `refactor` | Code restructuring without behavior change     |
| `docs`     | Documentation only                             |
| `style`    | Formatting, whitespace (no logic change)       |
| `test`     | Adding or updating tests                       |
| `perf`     | Performance improvement                        |
| `ci`       | CI/CD pipeline changes                         |

### Examples

```
feat: add backlinks panel below editor
fix: checkbox alignment in task nodes
chore: reorganize infrastructure folder
refactor: split editor components into subdirectories
docs: update README with Phase 8 changes
perf: debounce Yjs save to reduce IndexedDB writes
```

### Rules

- Use lowercase, no period at end
- Keep the first line under 72 characters
- Use imperative mood ("add" not "added", "fix" not "fixes")
- Reference issue numbers when applicable: `fix: resolve crash on empty note (#42)`

## Folder Structure

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

## Development Setup

1. Install Node.js 20+ and Rust toolchain
2. `npm install` in the root directory
3. `npm run tauri dev` to start the Tauri dev server
4. The app opens automatically with hot reload

## Code Style

- TypeScript strict mode
- Tailwind CSS for styling (no separate CSS files for components)
- React functional components with hooks
- Contexts for shared state (no Redux)
- TipTap for the rich text editor
- Yjs for real-time collaboration and offline persistence
