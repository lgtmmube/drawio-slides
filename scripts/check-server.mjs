// Run with either Node on Linux/macOS or the Windows Node executable.
// Uses an isolated fixture; never reads or writes users' draw.io files.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const temporary = await mkdtemp(join(tmpdir(), 'drawio-slides-server-test-'));
let child;
try {
  await mkdir(join(temporary, 'scripts'));
  await mkdir(join(temporary, 'dist', 'editor'), { recursive: true });
  await cp(join(dirname(fileURLToPath(import.meta.url)), 'serve.mjs'), join(temporary, 'scripts', 'serve.mjs'));
  await writeFile(join(temporary, 'dist', 'index.html'), '<h1>slides fixture</h1>');
  await writeFile(join(temporary, 'dist', 'editor', 'index.html'), '<h1>editor fixture</h1>');
  await writeFile(join(temporary, 'dist', 'font.woff2'), 'font fixture');
  await writeFile(join(temporary, 'secret.txt'), 'must not be served');

  const reserve = http.createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const options = ['scripts/serve.mjs', '--port', String(port)];
  child = spawn(process.execPath, options, { cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const output = [];
  child.stdout.on('data', data => output.push(data.toString()));
  child.stderr.on('data', data => output.push(data.toString()));
  const base = `http://127.0.0.1:${port}`;
  let started = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      started = (await fetch(base + '/__drawio_slides_health')).ok;
      if (started) break;
    } catch { /* Startup is still in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(started, output.join(''));
  assert.equal(await (await fetch(base + '/')).text(), '<h1>slides fixture</h1>');
  assert.equal(await (await fetch(base + '/editor/')).text(), '<h1>editor fixture</h1>');
  assert.deepEqual(await (await fetch(base + '/__drawio_slides_health')).json(), { app: 'drawio-slides', ready: true });
  assert.equal((await fetch(base + '/font.woff2')).headers.get('content-type'), 'font/woff2');
  assert.equal(await (await fetch(base + '/', { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base + '/scripts/serve.mjs')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e%2fsecret.txt')).status, 403);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(base + '/', { headers: { host: 'untrusted.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const repeated = spawn(process.execPath, options, { cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let repeatedOutput = '';
  repeated.stdout.on('data', data => repeatedOutput += data.toString());
  const [exitCode] = await once(repeated, 'exit');
  assert.equal(exitCode, 0);
  assert.match(repeatedOutput, /already running/);
  console.log(`Static server checks passed (${process.platform}; ${process.version}): files, editor directory, fonts, HEAD, health, duplicate launch, path/host/method restrictions.`);
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
