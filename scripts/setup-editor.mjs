import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, cp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pin both the upstream release and its exact archive so builds do not silently update.
const VERSION = '32.4.1';
const SHA256 = '96457199f6953ffaa1b5fb80ef3cd86e329ca5b51e52c67e3892aebaf3977395';
const URL = `https://codeload.github.com/jgraph/drawio/tar.gz/refs/tags/v${VERSION}`;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(projectRoot, 'public', 'editor');
const markerPath = join(destination, 'drawio-slides-vendor.json');
const args = process.argv.slice(2);
const archiveIndex = args.indexOf('--archive');
const suppliedArchive = archiveIndex >= 0 ? args[archiveIndex + 1] : null;

if (archiveIndex >= 0 && !suppliedArchive) throw new Error('--archive requires a path.');
if (!args.includes('--force')) {
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (marker.version === VERSION && marker.archiveSha256 === SHA256) {
      await access(join(destination, 'index.html'));
      await access(join(destination, 'js', 'app.min.js'));
      console.log(`draw.io ${VERSION} is already installed. Use --force to reinstall.`);
      process.exit(0);
    }
  } catch { /* Install on a fresh or incomplete checkout. */ }
}

const temporary = await mkdtemp(join(tmpdir(), 'drawio-slides-'));
try {
  console.log(`Preparing official draw.io ${VERSION}…`);
  let archive;
  if (suppliedArchive) {
    archive = await readFile(resolve(suppliedArchive));
  } else {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }
  const checksum = createHash('sha256').update(archive).digest('hex');
  if (checksum !== SHA256) throw new Error(`Archive checksum mismatch: ${checksum}`);
  const archivePath = join(temporary, 'drawio.tar.gz');
  await writeFile(archivePath, archive);

  // Windows 10/11 and typical macOS/Linux installations include tar.
  // Extract only the web editor and upstream licensing files, not the source server.
  const prefix = `drawio-${VERSION}`;
  const extracted = spawnSync('tar', ['-xzf', archivePath, '-C', temporary,
    `${prefix}/src/main/webapp`, `${prefix}/LICENSE`, `${prefix}/README.md`], {
    stdio: 'inherit', windowsHide: true,
  });
  if (extracted.error || extracted.status !== 0) {
    throw new Error('Could not unpack draw.io. Install the tar utility and rerun this command.');
  }
  const source = join(temporary, prefix, 'src', 'main', 'webapp');
  // These are Java server deployment files, never required by the local browser editor.
  await rm(join(source, 'WEB-INF'), { recursive: true, force: true });
  await cp(join(temporary, prefix, 'LICENSE'), join(source, 'DRAWIO-LICENSE.txt'));
  await cp(join(temporary, prefix, 'README.md'), join(source, 'DRAWIO-UPSTREAM-README.md'));

  // PreConfig is the supported upstream customization point. Register the documented
  // Draw.loadPlugin callback immediately before App.main runs, avoiding a polling race.
  const preConfig = join(source, 'js', 'PreConfig.js');
  await writeFile(preConfig, await readFile(preConfig, 'utf8') + `\n
// Local changes by drawio-slides: local-only defaults and a same-origin host bridge.
window.DRAWIO_BASE_URL = window.location.origin + '/editor';
window.DRAWIO_VIEWER_URL = window.location.origin + '/editor/js/viewer.min.js';
window.DRAWIO_LIGHTBOX_URL = window.location.origin + '/editor';
urlParams['offline'] = '1';
urlParams['local'] = '1';
urlParams['sync'] = 'manual';
(function () {
  var originalCheckAllLoaded = window.checkAllLoaded;
  var registered = false;
  window.checkAllLoaded = function () {
    if (!registered && window.mxScriptsLoaded && window.mxWinLoaded && window.App) {
      registered = true;
      App.initPluginCallback();
      App.embedModePluginsCount++;
      Draw.loadPlugin(function (ui) {
        window.__drawioUi = ui;
      });
    }
    return originalCheckAllLoaded.apply(this, arguments);
  };
})();
`);
  await writeFile(join(source, 'drawio-slides-vendor.json'), JSON.stringify({
    version: VERSION, source: URL, archiveSha256: SHA256,
    modifications: ['Removed Java WEB-INF server files', 'Added local host bridge to js/PreConfig.js'],
  }, null, 2) + '\n');
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
  console.log(`Installed draw.io ${VERSION} in public/editor (including local math, fonts, and stencils).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
