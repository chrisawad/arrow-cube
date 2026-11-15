import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function buildWorker() {
  const directory = mkdtempSync(join(tmpdir(), 'arrow-cube-worker-'));
  try {
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist/index.html'), '<!doctype html><title>Arrow Cube</title>');
    writeFileSync(join(directory, 'dist/manifest.webmanifest'), '{"name":"Arrow Cube"}');
    writeFileSync(join(directory, 'dist/icon.png'), 'test icon');
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-sw.mjs', import.meta.url))], { cwd: directory });
    return readFileSync(join(directory, 'dist/sw.js'), 'utf8');
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temporary worker directory');
    rmSync(directory, { recursive: true });
  }
}
const workerSource = buildWorker();
const scope = 'https://example.com/arrow-cube/';
const manifestURL = scope + 'manifest.webmanifest';
const manifest = icon => new Response(JSON.stringify({ icons: [{ src: icon }] }), { headers: { 'content-type': 'application/manifest+json' } });
function worker(fetch) {
  const handlers = new Map(), cached = new Map([[manifestURL, manifest('old-icon.png')], [scope + 'icon.png', new Response('offline icon')]]);
  vm.runInNewContext(workerSource, { URL, Request, Response, fetch,
    caches: { match: async url => cached.get(url)?.clone() },
    self: { location: { origin: 'https://example.com' }, registration: { scope }, addEventListener: (type, handler) => handlers.set(type, handler) },
  });
  return async url => {
    let response;
    handlers.get('fetch')({ request: new Request(url), respondWith: value => { response = value; } });
    return await response;
  };
}

test('manifest updates use fresh network metadata while an older offline cache is active', async () => {
  const request = worker(async request => {
    assert.equal(request.url, manifestURL);
    assert.equal(request.cache, 'no-cache');
    return manifest('new-icon.png');
  });
  assert.equal((await (await request(manifestURL)).json()).icons[0].src, 'new-icon.png');
});

test('offline or invalid manifest responses retain the valid cached app metadata', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => new Response('<title>Login</title>', { headers: { 'content-type': 'text/html' } })]) {
    const response = await worker(fetch)(manifestURL);
    assert.equal((await response.json()).icons[0].src, 'old-icon.png');
  }
});

test('pre-cached artwork stays available offline without additional network requests', async () => {
  const response = await worker(() => assert.fail('cached images must remain local'))(scope + 'icon.png');
  assert.equal(await response.text(), 'offline icon');
});
