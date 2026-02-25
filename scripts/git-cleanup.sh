#!/bin/bash
# git-cleanup.sh
# Run this ONCE after updating .gitignore to remove newly-ignored files from git tracking.
# This does NOT delete the files from disk — only from git's index.

set -e

echo "=== Onyx Git Cleanup ==="
echo ""
echo "Removing newly-ignored files from git tracking..."
echo "(Files remain on disk, just untracked by git)"
echo ""

# Build outputs
git rm -r --cached dist/ 2>/dev/null && echo "  Removed: dist/" || true
git rm -r --cached dist-ssr/ 2>/dev/null && echo "  Removed: dist-ssr/" || true
git rm -r --cached target/ 2>/dev/null && echo "  Removed: target/" || true
git rm -r --cached apps/desktop/target/ 2>/dev/null && echo "  Removed: apps/desktop/target/" || true
git rm -r --cached gen/ 2>/dev/null && echo "  Removed: gen/" || true
git rm -r --cached apps/desktop/gen/ 2>/dev/null && echo "  Removed: apps/desktop/gen/" || true

# Dependencies (should already be ignored but just in case)
git rm -r --cached node_modules/ 2>/dev/null && echo "  Removed: node_modules/" || true


# Infrastructure secrets
for f in infrastructure/**/*.env; do
    git rm --cached "$f" 2>/dev/null && echo "  Removed: $f" || true
done
for f in infrastructure/deploy/*.pem infrastructure/deploy/*.key; do
    git rm --cached "$f" 2>/dev/null && echo "  Removed: $f" || true
done

# Build outputs
for f in dist/ target/ node_modules/; do
    git rm -r --cached "$f" 2>/dev/null && echo "  Removed: $f" || true
done

# Environment files
for f in .env .env.*; do
    if [[ "$f" != ".env.example" ]]; then
        git rm --cached "$f" 2>/dev/null && echo "  Removed: $f" || true
    fi
done

# OS junk
git rm --cached .DS_Store 2>/dev/null && echo "  Removed: .DS_Store" || true
git rm --cached Thumbs.db 2>/dev/null && echo "  Removed: Thumbs.db" || true

# Dev dumps
git rm --cached find_profile.txt 2>/dev/null && echo "  Removed: find_profile.txt" || true
git rm --cached AI_CHEATSHEET.md 2>/dev/null && echo "  Removed: AI_CHEATSHEET.md" || true

# Secrets
for f in deploy/*.pem deploy/*.key; do
    git rm --cached "$f" 2>/dev/null && echo "  Removed: $f" || true
done

# The mystery file named "2" in src-tauri
git rm --cached src-tauri/2 2>/dev/null && echo "  Removed: src-tauri/2" || true

# Production data dirs
git rm -r --cached deploy/pb_data/ 2>/dev/null && echo "  Removed: deploy/pb_data/" || true
git rm -r --cached deploy/hp_data/ 2>/dev/null && echo "  Removed: deploy/hp_data/" || true
git rm -r --cached deploy/caddy_data/ 2>/dev/null && echo "  Removed: deploy/caddy_data/" || true
git rm -r --cached deploy/caddy_config/ 2>/dev/null && echo "  Removed: deploy/caddy_config/" || true

echo ""
echo "Done! Now commit the cleanup:"
echo '  git commit -m "chore: remove newly-ignored files from tracking"'
echo ""
