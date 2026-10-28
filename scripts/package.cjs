const { packager } = require('@electron/packager');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const outputs = path.resolve(root, '..');
const work = process.env.MELD_BUILD_DIR ? path.resolve(process.env.MELD_BUILD_DIR) : path.join(root, '.build');
const electronVersion = require('electron/package.json').version;
(async () => {
  fs.mkdirSync(work, { recursive: true });
  // A clean staging folder avoids shipping development dependencies, fixtures,
  // private runtime state or pnpm symlinks. The app has no npm runtime dependencies.
  const staging = path.join(work, 'app'); fs.mkdirSync(staging, { recursive: true });
  for (const file of ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY.md']) fs.copyFileSync(path.join(root, file), path.join(staging, file));
  fs.cpSync(path.join(root, 'src'), path.join(staging, 'src'), { recursive: true });
  for (const [platform, arch, label] of [['darwin', 'arm64', 'macOS-AppleSilicon'], ['win32', 'x64', 'Windows-x64']]) {
    const [folder] = await packager({ dir: staging, name: 'Meld', executableName: 'Meld', platform, arch, electronVersion, out: work, overwrite: true, asar: true, prune: false, appBundleId: 'music.meld.desktop', appCategoryType: 'public.app-category.music', darwinDarkModeSupport: true, icon: path.join(root, 'assets', platform === 'darwin' ? 'icon.icns' : 'icon.ico'), win32metadata: { CompanyName: 'Meld', FileDescription: 'Meld Music Player', ProductName: 'Meld' } });
    if (platform === 'darwin') {
      for (const [source, target] of [['LICENSE', 'Electron.LICENSE'], ['LICENSES.chromium.html', 'LICENSES.chromium.html']]) fs.copyFileSync(path.join(folder, source), path.join(folder, 'Meld.app/Contents/Resources', target));
      // Local ad-hoc signature for Apple Silicon; this is not Apple notarization.
      execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', path.join(folder, 'Meld.app')], { stdio: 'inherit' });
      execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(folder, 'Meld.app'), path.join(outputs, `Meld-0.1.0-${label}.zip`)]);
    } else {
      // Portable distribution: extract the entire folder, then run Meld.exe.
      fs.copyFileSync(path.join(root, 'README.md'), path.join(folder, 'START-HERE.md'));
      execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', folder, path.join(outputs, `Meld-0.1.0-${label}.zip`)]);
    }
    console.log('Packaged', platform, arch, folder);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
