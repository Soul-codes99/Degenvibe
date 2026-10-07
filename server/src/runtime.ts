import { loadCfg } from './config.js';
import { makeChain } from './chain.js';
import { createService } from './service.js';
import { PgStore } from './pgStore.js';
import { MemoryStore } from './store.js';

export function boot(env: Record<string, string | undefined> = process.env) {
  const cfg = loadCfg(env);
  const store = env.DATABASE_URL ? new PgStore(env.DATABASE_URL) : new MemoryStore();
  if (!env.DATABASE_URL) console.warn('DATABASE_URL not set: using in-memory store (local development only)');
  return { cfg, store, svc: createService(cfg, store, makeChain(cfg)) };
}
