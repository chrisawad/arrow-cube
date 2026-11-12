import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve('dist');
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && entry.name !== 'sw.js' && !entry.name.endsWith('.map')) files.push(absolute);
  }
  return files.sort();
}
const files = await walk(root);
if (!files.includes(resolve(root, 'index.html'))) throw new Error('Build the app before generating its service worker.');
const hash = createHash('sha256');
for (const file of files) { hash.update(relative(root, file)); hash.update(await readFile(file)); }
const version = hash.digest('hex').slice(0, 14);
// Cache the canonical root rather than /index.html, which static hosts may redirect.
const urls = files.map(file => file === resolve(root, 'index.html') ? './' : './' + relative(root, file).split(sep).join('/'));
const worker = `// Generated from the exact build contents. Do not edit by hand.
const CACHE = 'arrow-cube-' + ${JSON.stringify(version)};
const FILES = ${JSON.stringify(urls)};
const absolute = path => new URL(path, self.registration.scope).href;
const PRECACHED = new Set(FILES.map(absolute));
const INDEX = absolute('./');

// Refuse login/error redirects: private hosting must never become an offline login page.
function validResponse(response, url) {
  if (!response.ok || response.redirected || response.type === 'opaque') return false;
  if (response.url && response.url !== url) return false;
  const type = response.headers.get('content-type') || '';
  if (url === INDEX || url.endsWith('.html')) return type.includes('text/html');
  return !type.includes('text/html');
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await Promise.all(FILES.map(async file => {
        const url = absolute(file);
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
        if (!validResponse(response, url)) throw new Error('Offline asset unavailable: ' + file);
        await cache.put(url, response);
      }));
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('arrow-cube-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // This is a static app. No runtime caching of API, account, or auth responses.
  if (request.mode === 'navigate' && url.href.startsWith(self.registration.scope)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
        return (await caches.match(INDEX)) || response;
      } catch {
        return (await caches.match(INDEX)) || Response.error();
      }
    })());
  } else if (PRECACHED.has(url.href)) {
    event.respondWith((async () => (await caches.match(url.href)) || fetch(request))());
  }
});
`;
await writeFile(resolve(root, 'sw.js'), worker);
console.log(`Offline worker ready: ${files.length} assets, version ${version}.`);
