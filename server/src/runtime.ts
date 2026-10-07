import { loadCfg } from './config.ts';
import { makeChain } from './chain.ts';
import { createService } from './service.ts';
import { PgStore } from './pgStore.ts';
import { MemoryStore } from './store.ts';

export function boot(env: Record<string, string | undefined> = process.env) {
  const cfg = loadCfg(env);
  const store = env.DATABASE_URL ? new PgStore(env.DATABASE_URL) : new MemoryStore();
  if (!env.DATABASE_URL) console.warn('DATABASE_URL not set: using in-memory store (local development only)');
  return { cfg, store, svc: createService(cfg, store, makeChain(cfg)) };
}
