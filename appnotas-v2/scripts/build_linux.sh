#!/bin/bash

# Build script for NoteApp on Linux (Fedora/RPM)

echo "🚀 Starting NoteApp build process for RPM..."

# Check for Bun (as noted in user request, it might be missing)
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed. Please install it to continue."
    # Since the user mentioned development is on Fedora, they might use npm as a fallback
    if command -v npm &> /dev/null; then
        echo "💡 Falling back to npm..."
        npm install
        npm run build
        npx tauri build --bundle rpm
    else
        echo "❌ No package manager found. Please install Bun or Node.js."
        exit 1
    fi
else
    bun install
    bun run build
    bun tauri build --bundle rpm
fi

echo "✅ Build complete! Check src-tauri/target/release/bundle/rpm/ for the package."
