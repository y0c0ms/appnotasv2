#!/bin/bash
set -e

# Load user profile to ensure Rust/Cargo is available
source $HOME/.cargo/env 2>/dev/null || true
export PATH="$HOME/.bun/bin:$PATH"

echo "Ì∞ß Linux Build Environment:"
echo "   User: $(whoami)"
echo "   Dir: $(pwd)"
echo "   Bun: $(bun --version || echo 'Not Found')"
echo "   Cargo: $(cargo --version || echo 'Not Found')"

# Fail fast if tools missing
if ! command -v bun &> /dev/null; then
    echo "‚ùå Error: bun not found"
    exit 1
fi
if ! command -v cargo &> /dev/null; then
    echo "‚ùå Error: cargo not found"
    exit 1
fi

# Find the temp build directory relative to this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Ì≥Ç Moving to project dir: $PROJECT_DIR"
cd "$PROJECT_DIR"

echo "Ì¥® Installing Dependencies..."
bun install

echo "ÌøóÔ∏è Building RPM..."
bun run tauri build --bundles rpm

echo "‚úÖ Build Complete!"
ls -R src-tauri/target/release/bundle/rpm
