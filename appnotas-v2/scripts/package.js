import { spawn } from 'child_process';

const args = process.argv.slice(2);
const forceLinux = args.includes('--linux');

// Detect if we are in WSL (even if running Windows Bun binary)
const isWSL = process.env.WSL_DISTRO_NAME !== undefined ||
    process.env.PATH?.includes('/mnt/c/') ||
    process.env.PWD?.includes('/mnt/c/') ||
    process.env.HOME?.startsWith('/home/');

const isWindowsPlatform = process.platform === 'win32';

// logic: Build for Linux if we are actually ON linux OR if we explicitly forced it
const buildLinux = (process.platform === 'linux' || forceLinux);
const buildWindows = isWindowsPlatform && !forceLinux;

async function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const fullCmd = `${command} ${args.join(' ')}`;
        console.log(`\n🚀 Running: ${fullCmd}`);
        const proc = spawn(command, args, {
            stdio: 'inherit',
            shell: true
        });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${command} exited with code ${code}`));
        });
    });
}

async function build() {
    console.log('📦 Starting AppNotas Packaging Process...');

    try {
        if (buildWindows) {
            if (isWSL) {
                console.warn('\n⚠️  Note: Running in WSL with Windows environment.');
                console.warn('   This will generate a WINDOWS (.exe) installer.');
                console.warn('   To build for Linux (RPM) instead, run: bun run package:linux');
            }
            console.log('\n🪟 Building Windows NSIS Installer...');
            await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'nsis']);
            console.log('\n✅ Windows Build Complete!');
        } else if (buildLinux) {
            console.log('\n🐧 Building Linux Packages...');
            try {
                console.log('\n💎 Attempting RPM Build...');
                await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'rpm']);
                console.log('\n✅ RPM Build Complete!');
            } catch (e) {
                console.warn('\n⚠️ RPM build failed (usually needs specific tools).');
                console.log('\n📦 Attempting AppImage and Debian builds...');
                await runCommand('bun', ['x', 'tauri', 'build', '--bundles', 'appimage,deb']);
                console.log('\n✅ Linux Bundles Complete!');
            }
        }
    } catch (error) {
        console.error(`\n❌ Build failed: ${error.message}`);
        if (buildLinux) {
            console.log('\n💡 Linux Troubleshooting:');
            console.log('   Ensure you have installed: libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf rpm');
            console.log('   Note: On Ubuntu 24.04+, use "libwebkit2gtk-4.1-dev" instead of "4.0".');
        }
        process.exit(1);
    }
}

build();
