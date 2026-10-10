import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDirectory = resolve(projectRoot, 'dist');
const args = process.argv.slice(2);
const shouldOpenBrowser = args.includes('--open') && !args.includes('--no-open');
const portFlag = args.indexOf('--port');
const port = Number(portFlag >= 0 ? args[portFlag + 1] : process.env.DRAWIO_SLIDES_PORT || process.env.PORT || 48765);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid port. Set DRAWIO_SLIDES_PORT to a number from 1 to 65535.');
  process.exit(1);
}
const localUrl = `http://127.0.0.1:${port}/`;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.map': 'application/json',
};

function openBrowser() {
  let command, browserArgs;
  if (process.platform === 'win32') {
    command = 'rundll32.exe';
    browserArgs = ['url.dll,FileProtocolHandler', localUrl];
  } else if (process.platform === 'darwin') {
    command = 'open';
    browserArgs = [localUrl];
  } else if (process.env.WSL_DISTRO_NAME) {
    command = '/mnt/c/Windows/explorer.exe';
    browserArgs = [localUrl];
  } else {
    command = 'xdg-open';
    browserArgs = [localUrl];
  }
  const child = spawn(command, browserArgs, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Open this address in your browser: ${localUrl}`));
  child.unref();
}

try {
  await access(resolve(rootDirectory, 'index.html'));
  await access(resolve(rootDirectory, 'editor', 'index.html'));
} catch {
  console.error('The built app is missing. In the source folder run npm install, npm run setup:editor, and npm run build.');
  process.exit(1);
}
const canonicalRoot = await realpath(rootDirectory);

const server = http.createServer(async (request, response) => {
  const fail = (status, message) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(message);
  };
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.host || '')) {
    return fail(403, 'Local requests only.');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return fail(405, 'Method not allowed.');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, localUrl).pathname);
  } catch {
    return fail(400, 'Invalid URL.');
  }
  if (pathname === '/__drawio_slides_health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ app: 'drawio-slides', ready: true }));
    return;
  }
  if (pathname.includes('\0') || pathname.split(/[\\/]/).includes('..')) {
    return fail(403, 'Invalid path.');
  }
  let filePath = resolve(canonicalRoot, `.${pathname}`);
  if (filePath !== canonicalRoot && !filePath.startsWith(canonicalRoot + sep)) {
    return fail(403, 'Invalid path.');
  }
  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
      info = await stat(filePath);
    }
    const canonicalFile = await realpath(filePath);
    if (!canonicalFile.startsWith(canonicalRoot + sep) || !info.isFile()) {
      return fail(403, 'Invalid path.');
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(canonicalFile).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(canonicalFile);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    }
  } catch (error) {
    fail(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'File not found.');
  }
});

server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${localUrl}__drawio_slides_health`, { signal: AbortSignal.timeout(2000) });
      const health = await response.json();
      if (health.app === 'drawio-slides' && health.ready) {
        console.log(`Drawio Slides is already running: ${localUrl}`);
        if (shouldOpenBrowser) openBrowser();
        process.exit(0);
      }
    } catch { /* Another program owns this port. */ }
    console.error(`Port ${port} is in use. Set DRAWIO_SLIDES_PORT to a different port and try again.`);
  } else {
    console.error(`Could not start the app: ${error.message}`);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Drawio Slides: ${localUrl}`);
  console.log('Keep this window open while editing. Press Ctrl+C to stop.');
  if (shouldOpenBrowser) openBrowser();
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
