// Vercel entry point. vercel.json rewrites every /api/* request here.
import { handle } from '../src/http.ts';
import { boot } from '../src/runtime.ts';

let app: ReturnType<typeof boot> | undefined;
export default async function (req: any, res: any) {
  app ??= boot();
  const { cfg, svc } = app;
  res.setHeader('access-control-allow-origin', cfg.allowedOrigin);
  res.setHeader('access-control-allow-headers', 'authorization,content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const out = await handle(svc, cfg, { method: req.method, path: new URL(req.url, 'http://x').pathname, headers: req.headers, body: req.body });
  res.status(out.status).json(out.body);
}
