import { spawn } from 'child_process';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
const forceLinux = args.includes('--linux');
const buildAll = args.includes('--all');

const isWindowsPlatform = process.platform === 'win32';

// Path constants
const ROOT_DIR = resolve(process.cwd());
const BUNDLE_DIR = join(ROOT_DIR, 'bundle');
const SRC_TAURI_TARGET = join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle');

async function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const fullCmd = `${command} ${args.join(' ')}`;
        console.log(`\n🚀 Running: ${fullCmd}`);
        const proc = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            cwd: ROOT_DIR
        });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${command} exited with code ${code}`));
        });
    });
}

function ensureBundleDir() {
    if (!existsSync(BUNDLE_DIR)) {
        mkdirSync(BUNDLE_DIR);
    }
}

async function copyArtifacts() {
    console.log('\n📦 Collecting artifacts into /bundle folder...');
    ensureBundleDir();

    // 1. Copy Windows EXE
    if (isWindowsPlatform) {
        const nsisDir = join(SRC_TAURI_TARGET, 'nsis');
        if (existsSync(nsisDir)) {
            const files = readdirSync(nsisDir).filter(f => f.endsWith('.exe'));
            files.forEach(f => {
                copyFileSync(join(nsisDir, f), join(BUNDLE_DIR, f));
                console.log(`   ✅ Copied: ${f}`);
            });
        }
    }

    // 2. Copy Linux RPM (Found in same structure if built via WSL, because target is shared usually, 
    //    BUT WSL might write to a different target if not set up to share. 
    //    Usually, if running from Windows > WSL, the project dir is mounted.
    //    So target/release/bundle/rpm should exist here too.)
    const rpmDir = join(SRC_TAURI_TARGET, 'rpm');
    if (existsSync(rpmDir)) {
        const files = readdirSync(rpmDir).filter(f => f.endsWith('.rpm'));
        files.forEach(f => {
            copyFileSync(join(rpmDir, f), join(BUNDLE_DIR, f));
            console.log(`   ✅ Copied: ${f}`);
        });
    }
}

async function build() {
    console.log('📦 Starting AppNotas Packaging Process...');

    try {
        if (buildAll && isWindowsPlatform) {
            console.log('\n🔄 Mode: ALL (Windows + Linux/WSL)');

            // 1. Windows Build
            console.log('\n🪟 [1/2] Building Windows Installer...');
            await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'nsis']);

            // 2. Linux Build via WSL
            console.log('\n🐧 [2/2] Building Linux RPM (via WSL)...');
            // We use 'bun run tauri:build' inside WSL. 
            // We explicitly pass the target to ensure it knows we want Linux, 
            // avoiding issues where it might detect Windows from shared envs.
            await runCommand('wsl', ['bun', 'run', 'tauri', 'build', '--target', 'x86_64-unknown-linux-gnu', '--bundles', 'rpm']);

        } else if (isWindowsPlatform && !forceLinux) {
            console.log('\n🪟 Building Windows Installer Only...');
            await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'nsis']);

        } else if (forceLinux || process.platform === 'linux') {
            console.log('\n🐧 Building Linux Packages...');
            await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'rpm']);
        }

        // Post-build: Collect artifacts
        await copyArtifacts();

        console.log('\n✨ All builds complete! Check the "bundle" folder.');

    } catch (error) {
        console.error(`\n❌ Build failed: ${error.message}`);
        process.exit(1);
    }
}

build();
