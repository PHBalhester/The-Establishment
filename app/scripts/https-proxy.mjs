/**
 * Simple HTTPS reverse proxy for mobile dev testing.
 * Proxies https://0.0.0.0:3443 → http://localhost:3000
 *
 * Usage: node scripts/https-proxy.mjs
 * Then access https://192.168.0.5:3443/launch on your phone.
 * You'll get a security warning — tap "Advanced" → "Proceed" to bypass.
 */
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';

const key = readFileSync(new URL('../certificates/localhost-key.pem', import.meta.url));
const cert = readFileSync(new URL('../certificates/localhost.pem', import.meta.url));

const proxy = createServer({ key, cert }, (clientReq, clientRes) => {
  const opts = {
    hostname: 'localhost',
    port: 3000,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };
  const proxyReq = request(opts, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });
  proxyReq.on('error', (err) => {
    clientRes.writeHead(502);
    clientRes.end('Proxy error: ' + err.message);
  });
  clientReq.pipe(proxyReq, { end: true });
});

proxy.listen(3443, '0.0.0.0', () => {
  console.log('HTTPS proxy listening on https://0.0.0.0:3443 → http://localhost:3000');
});
