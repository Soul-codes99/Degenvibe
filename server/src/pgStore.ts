import pg from 'pg';
import type { RunState } from './engine.ts';
import type { Store } from './store.ts';

export const SCHEMA = `
create table if not exists runs (
  commit text primary key, player text not null, status text not null,
  data jsonb not null, created_at timestamptz not null default now());
create index if not exists runs_player_idx on runs (lower(player), status);
create table if not exists nonces (nonce text primary key, created_at timestamptz not null default now());`;

/** Postgres store (Neon, Supabase or any Postgres). update() uses SELECT ... FOR UPDATE, so refresh spam
 *  and double clicks can never resolve the same run twice. */
export class PgStore implements Store {
  private pool: pg.Pool; private ready?: Promise<unknown>;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 3, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false } }); }
  private init() { return (this.ready ??= this.pool.query(SCHEMA)); }
  async insert(r: RunState) { await this.init(); await this.pool.query('insert into runs (commit, player, status, data) values ($1,$2,$3,$4)', [r.commit, r.player.toLowerCase(), r.status, r]); }
  async get(commit: string) { await this.init(); const q = await this.pool.query('select data from runs where commit=$1', [commit]); return q.rows[0]?.data ?? null; }
  async update<T>(commit: string, fn: (run: RunState) => Promise<{ run: RunState; out: T }>) {
    await this.init();
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const q = await c.query('select data from runs where commit=$1 for update', [commit]);
      if (!q.rows[0]) throw new Error('unknown run');
      const { run, out } = await fn(q.rows[0].data);
      await c.query('update runs set data=$2, status=$3 where commit=$1', [commit, run, run.status]);
      await c.query('commit'); return out;
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }
  async activeByPlayer(player: string) {
    await this.init();
    const q = await this.pool.query(`select data from runs where lower(player)=$1 and status in ('ticketed','open','settling') order by created_at desc limit 1`, [player.toLowerCase()]);
    return q.rows[0]?.data ?? null;
  }
  async settling() { await this.init(); return (await this.pool.query(`select data from runs where status='settling'`)).rows.map((x) => x.data); }
  async history(player: string, limit: number) {
    await this.init();
    return (await this.pool.query(`select data from runs where lower(player)=$1 and status='settled' order by created_at desc limit $2`, [player.toLowerCase(), limit])).rows.map((x) => x.data);
  }
  async volume(player: string) {
    await this.init();
    const q = await this.pool.query(`select coalesce(sum((data->>'stake')::numeric),0)::text as v from runs where lower(player)=$1 and status in ('open','settling','settled')`, [player.toLowerCase()]);
    return BigInt(q.rows[0].v);
  }
  async putNonce(n: string) { await this.init(); await this.pool.query('insert into nonces (nonce) values ($1)', [n]); }
  async useNonce(n: string) { await this.init(); return ((await this.pool.query(`delete from nonces where nonce=$1 and created_at > now() - interval '15 minutes'`, [n])).rowCount ?? 0) > 0; }
  async operatorLock<T>(fn: () => Promise<T>) {
    await this.init();
    const c = await this.pool.connect();
    try { await c.query('select pg_advisory_lock(7770001)'); return await fn(); }
    finally { await c.query('select pg_advisory_unlock(7770001)').catch(() => {}); c.release(); }
  }
}
