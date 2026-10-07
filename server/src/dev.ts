import { createServer } from 'node:http';
import { handle } from './http.js';
import { boot } from './runtime.js';

const { cfg, svc } = boot();
createServer(async (req, res) => {
  const cors = { 'access-control-allow-origin': cfg.allowedOrigin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  let raw = ''; for await (const c of req) raw += c;
  const url = new URL(req.url ?? '/', 'http://x');
  const out = await handle(svc, cfg, { method: req.method ?? 'GET', path: url.pathname, headers: req.headers as any, body: raw ? JSON.parse(raw) : undefined });
  res.writeHead(out.status, { 'content-type': 'application/json', ...cors }).end(JSON.stringify(out.body));
}).listen(Number(process.env.PORT ?? 8787), () => console.log('DEGEN VIBE server on :' + (process.env.PORT ?? 8787)));
