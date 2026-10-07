import type { Hex } from 'viem';
import type { Cfg } from './config.ts';
import type { Service } from './service.ts';

export interface Req { method: string; path: string; headers: Record<string, string | undefined>; body?: any }
export interface Res { status: number; body: unknown }
const clean = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200);

export async function handle(svc: Service, cfg: Cfg, req: Req): Promise<Res> {
  const route = `${req.method} ${req.path.replace(/\/+$/, '')}`;
  const bearer = () => (req.headers.authorization ?? '').replace(/^Bearer /i, '');
  try {
    switch (route) {
      case 'GET /api/config': return { status: 200, body: await svc.config() };
      case 'GET /api/nonce': {
        const nonce = await svc.nonce(); const issued = new Date().toISOString();
        return { status: 200, body: { nonce, issued, template: svc.loginMessage('<address>', nonce, issued) } };
      }
      case 'POST /api/login': {
        const { address, message, signature } = req.body ?? {};
        return { status: 200, body: { token: await svc.login(address, message, signature as Hex) } };
      }
      case 'POST /api/cron/settle':
        if (!cfg.cronSecret || bearer() !== cfg.cronSecret) return { status: 401, body: { error: 'unauthorised' } };
        return { status: 200, body: await svc.retrySettling() };
    }
    const player = svc.who(bearer());
    switch (route) {
      case 'POST /api/ticket': return { status: 200, body: await svc.ticket(player, req.body ?? {}) };
      case 'POST /api/confirm': return { status: 200, body: await svc.confirm(player, req.body?.txHash) };
      case 'POST /api/step': return { status: 200, body: await svc.step(player, req.body?.col, req.body?.activate) };
      case 'POST /api/cashout': return { status: 200, body: await svc.cashout(player) };
      case 'GET /api/run': return { status: 200, body: await svc.current(player) };
      case 'GET /api/history': return { status: 200, body: await svc.history(player) };
    }
    return { status: 404, body: { error: 'not found' } };
  } catch (e) {
    const msg = clean(e);
    return { status: /not signed in|session expired/.test(msg) ? 401 : 400, body: { error: msg } };
  }
}
