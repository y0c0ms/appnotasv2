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
        console.log(`\nÌ∫Ä Running: ${fullCmd}`);
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
    console.log('\nÌ≥¶ Collecting artifacts into /bundle folder...');
    ensureBundleDir();

    // 1. Copy Windows EXE
    if (isWindowsPlatform) {
        const nsisDir = join(SRC_TAURI_TARGET, 'nsis');
        if (existsSync(nsisDir)) {
            const files = readdirSync(nsisDir).filter(f => f.endsWith('.exe'));
            files.forEach(f => {
                copyFileSync(join(nsisDir, f), join(BUNDLE_DIR, f));
                console.log(`   ‚úÖ Copied: ${f}`);
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
            console.log(`   ‚úÖ Copied: ${f}`);
        });
    }
}

async function buildLinuxInWSL() {
    console.log('\nÌ∞ß [2/2] Building Linux RPM (via WSL Native)...');

    // 1. Convert Windows path to WSL path
    const cwd = process.cwd();
    const driveLetter = cwd.charAt(0).toLowerCase();
    const wslPath = `/mnt/${driveLetter}${cwd.slice(2).replace(/\\/g, '/')}`;
    const remoteBuildDir = `~/tmp_build_appnotas`;

    console.log(`   Ì≥Ç Mirroring to ${remoteBuildDir}...`);

    // 2. Rsync to WSL native fs (fast & reliable)
    // Exclude heavy/platform-specific folders
    await runCommand('wsl', [
        'rsync', '-av', '--delete',
        '--exclude', 'node_modules',
        '--exclude', 'src-tauri/target',
        '--exclude', '.git',
        '--exclude', 'bundle',
        `${wslPath}/`, `${remoteBuildDir}/`
    ]);

    // 3. Install & Build in WSL with Error Handling
    console.log('   Ì¥® Installing & Building in WSL (this may take a moment)...');
    try {
        // Ensure script is executable
        await runCommand('wsl', [
            'bash', '-c',
            `"chmod +x ${remoteBuildDir}/scripts/build_linux.sh"`
        ]);

        // Run the script directly
        await runCommand('wsl', [
            'bash', '-i', '-c',
            `"${remoteBuildDir}/scripts/build_linux.sh"`
        ]);
    } catch (e) {
        console.error('   ‚ùå WSL Build Step Failed:', e.message);
        console.error('      Ì±â Tip: Ensure Bun is installed INSIDE WSL: curl -fsSL https://bun.sh/install | bash');
        throw e;
    }

    // 4. Verify & Copy artifact back
    console.log('   Ì≥¶ Retrieving artifacts...');
    ensureBundleDir();
    const wslBundleDir = `/mnt/${driveLetter}${BUNDLE_DIR.slice(2).replace(/\\/g, '/')}`;
    
    // Also sync to local src-tauri/target to avoid stale files confusing the user
    // We recreate the path on Windows side first to be safe
    const localTargetRpmDir = join(SRC_TAURI_TARGET, 'rpm');
    if (!existsSync(localTargetRpmDir)) {
        mkdirSync(localTargetRpmDir, { recursive: true });
    }
    const wslTargetRpmDir = `/mnt/${driveLetter}${localTargetRpmDir.slice(2).replace(/\\/g, '/')}`;

    // List remote bundle dir first for debugging
    console.log('   Ì¥é Verifying remote artifacts...');
    try {
        await runCommand('wsl', [
            'bash', '-c',
            `"ls -R ${remoteBuildDir}/src-tauri/target/release/bundle"`
        ]);
    } catch (e) {
         console.warn("   ‚ö†Ô∏è Could not list bundle dir. Listing target root to debug:");
         try {
            await runCommand('wsl', [
                'bash', '-c',
                `"ls -F ${remoteBuildDir}/src-tauri/target/"`
            ]);
         } catch (ignored) {}
    }

    // Copy rpm using glob to BUNDLE_DIR
    try {
        console.log('   Ì¥Ñ Syncing to bundle/ folder...');
        await runCommand('wsl', [
            'bash', '-c',
            `"cp -v ${remoteBuildDir}/src-tauri/target/release/bundle/rpm/*.rpm ${wslBundleDir}/"`
        ]);
        
        console.log('   Ì¥Ñ Syncing to src-tauri/target/... (cleaning old versions first)...');
        // Clean old rpms in local target to avoid confusion
        await runCommand('wsl', [
            'bash', '-c',
            `"rm -f ${wslTargetRpmDir}/*.rpm && cp -v ${remoteBuildDir}/src-tauri/target/release/bundle/rpm/*.rpm ${wslTargetRpmDir}/"`
        ]);

        console.log('   ‚úÖ RPM retrieved & synced successfully!');
    } catch (e) {
        console.error('   ‚ùå Failed to retrieve RPM. It might not have been generated.');
        throw e;
    }
}

async function build() {
    console.log('Ì≥¶ Starting AppNotas Packaging Process...');

    try {
        if (buildAll && isWindowsPlatform) {
            console.log('\nÌ¥Ñ Mode: ALL (Windows + Linux/WSL)');
            
            // 1. Windows Build
            console.log('\nÌ∫ü [1/2] Building Windows Installer...');
            await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'nsis']);
            
            // COPY WINDOWS ARTIFACTS HERE
            await copyArtifacts();

            // 2. Linux Build via WSL (Sync -> Build -> Retrieve)
            await buildLinuxInWSL();
            
        } else if (isWindowsPlatform && !forceLinux) {
            console.log('\nÌ∫ü Building Windows Installer Only...');
            await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'nsis']);
            await copyArtifacts();

        } else if (forceLinux || process.platform === 'linux') {
            console.log('\nÌ∞ß Building Linux Packages (Native)...');
            await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'rpm']);
            await copyArtifacts();
        }

        console.log('\n‚ú® All builds complete! Check the "bundle" folder.');

    } catch (error) {
        console.error(`\n‚ùå Build failed: ${error.message}`);
        process.exit(1);
    }
}

build();
