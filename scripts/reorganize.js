#!/usr/bin/env node
/**
 * Phase 7 — Project Reorganization Script
 *
 * Run with:  node scripts/reorganize.js
 *
 * This script moves files into the new folder structure defined in Phase 7.
 * It also updates all import paths across the codebase.
 *
 * IMPORTANT: Run this AFTER committing all other Phase 7 changes.
 * This script is idempotent — it checks if files already exist before moving.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ─── Helper Functions ───────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`  📁 Created: ${path.relative(ROOT, dir)}`);
    }
}

function moveFile(from, to) {
    const absFrom = path.resolve(ROOT, from);
    const absTo = path.resolve(ROOT, to);

    if (!fs.existsSync(absFrom)) {
        console.log(`  ⏭ Skip (not found): ${from}`);
        return false;
    }
    if (fs.existsSync(absTo)) {
        console.log(`  ⏭ Skip (already exists): ${to}`);
        return false;
    }

    ensureDir(path.dirname(absTo));
    fs.renameSync(absFrom, absTo);
    console.log(`  ✅ Moved: ${from} → ${to}`);
    return true;
}

function copyDir(from, to) {
    const absFrom = path.resolve(ROOT, from);
    const absTo = path.resolve(ROOT, to);

    if (!fs.existsSync(absFrom)) {
        console.log(`  ⏭ Skip dir (not found): ${from}`);
        return;
    }
    if (fs.existsSync(absTo)) {
        console.log(`  ⏭ Skip dir (already exists): ${to}`);
        return;
    }

    ensureDir(absTo);
    fs.cpSync(absFrom, absTo, { recursive: true });
    console.log(`  ✅ Copied dir: ${from} → ${to}`);
}

// ─── Phase 1: Create New Directory Structure ────────────────

console.log('\n🔧 Phase 7 — Project Reorganization\n');
console.log('Step 1: Creating directory structure...\n');

const newDirs = [
    'apps/desktop/src/commands',
    'apps/desktop/capabilities',
    'apps/desktop/icons',
    'apps/server/hocuspocus',
    'apps/server/api',
    'apps/server/deploy',
    'packages/shared/types',
    'src/components/editor',
    'src/components/flashcards',
    'src/components/layout',
    'src/components/modals',
    'src/components/properties',
    'src/components/query',
    'src/components/settings',
    'src/components/today',
    'src/components/ui',
];

newDirs.forEach((d) => ensureDir(path.resolve(ROOT, d)));

// ─── Phase 2: Move Desktop App (src-tauri → apps/desktop) ──

console.log('\nStep 2: Moving desktop app (src-tauri → apps/desktop)...\n');

const tauriFiles = [
    ['src-tauri/Cargo.toml', 'apps/desktop/Cargo.toml'],
    ['src-tauri/Cargo.lock', 'apps/desktop/Cargo.lock'],
    ['src-tauri/build.rs', 'apps/desktop/build.rs'],
    ['src-tauri/tauri.conf.json', 'apps/desktop/tauri.conf.json'],
    ['src-tauri/.env', 'apps/desktop/.env'],
    ['src-tauri/.gitignore', 'apps/desktop/.gitignore'],
];

tauriFiles.forEach(([from, to]) => moveFile(from, to));

// Move src-tauri/src → apps/desktop/src (Rust source files)
const tauriSrcFiles = [
    ['src-tauri/src/main.rs', 'apps/desktop/src/main.rs'],
    ['src-tauri/src/lib.rs', 'apps/desktop/src/lib.rs'],
    ['src-tauri/src/commands.rs', 'apps/desktop/src/commands/mod.rs'],
    ['src-tauri/src/database.rs', 'apps/desktop/src/commands/database.rs'],
    ['src-tauri/src/email.rs', 'apps/desktop/src/commands/email.rs'],
];
tauriSrcFiles.forEach(([from, to]) => moveFile(from, to));

// Move capabilities and icons
copyDir('src-tauri/capabilities', 'apps/desktop/capabilities');
copyDir('src-tauri/icons', 'apps/desktop/icons');
copyDir('src-tauri/gen', 'apps/desktop/gen');

// ─── Phase 3: Move Server Files ─────────────────────────────

console.log('\nStep 3: Moving server files...\n');

// Hocuspocus server
const hocusFiles = [
    ['hocuspocus-server/package.json', 'apps/server/hocuspocus/package.json'],
    ['hocuspocus-server/index.js', 'apps/server/hocuspocus/index.js'],
    ['hocuspocus-server/Dockerfile', 'apps/server/hocuspocus/Dockerfile'],
    ['hocuspocus-server/.env', 'apps/server/hocuspocus/.env'],
];
hocusFiles.forEach(([from, to]) => moveFile(from, to));

// Rust API server
const serverFiles = [
    ['server/Cargo.toml', 'apps/server/api/Cargo.toml'],
    ['server/Cargo.lock', 'apps/server/api/Cargo.lock'],
    ['server/Dockerfile', 'apps/server/api/Dockerfile'],
    ['server/.env', 'apps/server/api/.env'],
    ['server/.env.example', 'apps/server/api/.env.example'],
];
serverFiles.forEach(([from, to]) => moveFile(from, to));
copyDir('server/src', 'apps/server/api/src');

// Deploy
copyDir('deploy', 'apps/server/deploy');

// ─── Phase 4: Move Frontend Components ──────────────────────

console.log('\nStep 4: Reorganizing src/components...\n');

const componentMoves = [
    // Layout components (from ui/ to layout/)
    ['src/components/ui/Sidebar.tsx', 'src/components/layout/Sidebar.tsx'],
    ['src/components/ui/TabBar.tsx', 'src/components/layout/TabBar.tsx'],
    ['src/components/ui/Titlebar.tsx', 'src/components/layout/Titlebar.tsx'],
    // The Toolbar is inside tiptap/ and stays in editor/

    // Flashcard components
    ['src/components/editor/FlashcardView.tsx', 'src/components/flashcards/FlashcardView.tsx'],

    // Modals
    ['src/components/ui/SearchModal.tsx', 'src/components/modals/SearchModal.tsx'],
    ['src/components/ui/LockModal.tsx', 'src/components/modals/LockModal.tsx'],
    ['src/components/ui/SettingsModal.tsx', 'src/components/modals/SettingsModal.tsx'],

    // Properties
    ['src/components/editor/PropertiesPanel.tsx', 'src/components/properties/PropertiesPanel.tsx'],
    ['src/components/editor/PropertyPills.tsx', 'src/components/properties/PropertyPills.tsx'],

    // Query/Collection
    ['src/components/editor/CollectionView.tsx', 'src/components/query/CollectionView.tsx'],
    ['src/components/editor/TopicQuery.tsx', 'src/components/query/TopicQuery.tsx'],

    // Today
    ['src/components/editor/TodayPage.tsx', 'src/components/today/TodayPage.tsx'],

    // UI primitives stay in ui/
    ['src/components/ui/NoteTypePicker.tsx', 'src/components/ui/NoteTypePicker.tsx'],
    ['src/components/ui/AccountPanel.tsx', 'src/components/ui/AccountPanel.tsx'],
    ['src/components/ui/UnlockScreen.tsx', 'src/components/ui/UnlockScreen.tsx'],
];

componentMoves.forEach(([from, to]) => {
    if (from !== to) moveFile(from, to);
});

// Settings v2 stays in settings/
// Calendar, cloud, email, messages, passwords, photos stay where they are

// ─── Phase 5: Update Import Paths ───────────────────────────

console.log('\nStep 5: Updating import paths...\n');

// Map of old import paths → new import paths (relative-style)
const importReplacements = [
    // Layout moves
    [/(['"])(.*)\/ui\/Sidebar(['"])/g, "$1$2/layout/Sidebar$3"],
    [/(['"])(.*)\/ui\/TabBar(['"])/g, "$1$2/layout/TabBar$3"],
    [/(['"])(.*)\/ui\/Titlebar(['"])/g, "$1$2/layout/Titlebar$3"],

    // Flashcard move
    [/(['"])(.*)\/editor\/FlashcardView(['"])/g, "$1$2/flashcards/FlashcardView$3"],

    // Modal moves
    [/(['"])(.*)\/ui\/SearchModal(['"])/g, "$1$2/modals/SearchModal$3"],
    [/(['"])(.*)\/ui\/LockModal(['"])/g, "$1$2/modals/LockModal$3"],
    [/from ['"]\.\/LockModal['"]/g, "from '../modals/LockModal'"],

    // Properties
    [/(['"])(.*)\/editor\/PropertiesPanel(['"])/g, "$1$2/properties/PropertiesPanel$3"],
    [/(['"])(.*)\/editor\/PropertyPills(['"])/g, "$1$2/properties/PropertyPills$3"],

    // Query
    [/(['"])(.*)\/editor\/CollectionView(['"])/g, "$1$2/query/CollectionView$3"],
    [/(['"])(.*)\/editor\/TopicQuery(['"])/g, "$1$2/query/TopicQuery$3"],

    // Today
    [/(['"])(.*)\/editor\/TodayPage(['"])/g, "$1$2/today/TodayPage$3"],
];

function updateImportsInFile(filePath) {
    const ext = path.extname(filePath);
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) return;

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return;
    }

    let modified = content;
    for (const [pattern, replacement] of importReplacements) {
        modified = modified.replace(pattern, replacement);
    }

    if (modified !== content) {
        fs.writeFileSync(filePath, modified, 'utf-8');
        console.log(`  📝 Updated imports: ${path.relative(ROOT, filePath)}`);
    }
}

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'target') continue;
            walkDir(fullPath, callback);
        } else {
            callback(fullPath);
        }
    }
}

walkDir(path.resolve(ROOT, 'src'), updateImportsInFile);

// ─── Phase 6: Update tauri.conf.json Reference ─────────────

console.log('\nStep 6: Checking tauri.conf.json...\n');

const tauriConfPath = path.resolve(ROOT, 'apps/desktop/tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
    let conf = fs.readFileSync(tauriConfPath, 'utf-8');
    // Update frontendDist and devUrl if they reference old paths
    conf = conf.replace(/"\.\.\/\.\.\/dist"/g, '"../../dist"');
    fs.writeFileSync(tauriConfPath, conf, 'utf-8');
    console.log('  ✅ tauri.conf.json checked');
}

// ─── Done ───────────────────────────────────────────────────

console.log('\n✨ Reorganization complete!\n');
console.log('Next steps:');
console.log('  1. Run `npm run build` to verify all imports resolve');
console.log('  2. Fix any remaining broken imports manually');
console.log('  3. Update tsconfig.json path aliases (see Phase 7 spec)');
console.log('  4. Update vite.config.ts resolve aliases');
console.log('');
