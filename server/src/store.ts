import type { RunState } from './engine.js';

export interface Store {
  insert(run: RunState): Promise<void>;
  get(commit: string): Promise<RunState | null>;
  /** Row-locked read-modify-write. Concurrent calls for the same run are serialised. */
  update<T>(commit: string, fn: (run: RunState) => Promise<{ run: RunState; out: T }>): Promise<T>;
  activeByPlayer(player: string): Promise<RunState | null>;     // ticketed, open or settling
  settling(): Promise<RunState[]>;
  volume(player: string): Promise<bigint>;                      // total ETH staked in confirmed runs (unlocks characters)
  history(player: string, limit: number): Promise<RunState[]>;  // settled runs, newest first
  putNonce(n: string): Promise<void>;
  useNonce(n: string): Promise<boolean>;                        // true once, then false
  operatorLock<T>(fn: () => Promise<T>): Promise<T>;            // one operator transaction at a time
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p;
  }
}

/** For tests and local development. State is lost on restart, so never use it in production. */
export class MemoryStore implements Store {
  private runs = new Map<string, RunState>(); private nonces = new Set<string>();
  private locks = new Map<string, Mutex>(); private op = new Mutex();
  private lock = (k: string) => { let m = this.locks.get(k); if (!m) this.locks.set(k, (m = new Mutex())); return m; };
  async insert(run: RunState) { if (this.runs.has(run.commit)) throw new Error('duplicate commit'); this.runs.set(run.commit, structuredClone(run)); }
  async get(commit: string) { const r = this.runs.get(commit); return r ? structuredClone(r) : null; }
  update<T>(commit: string, fn: (run: RunState) => Promise<{ run: RunState; out: T }>) {
    return this.lock(commit).run(async () => {
      const cur = this.runs.get(commit); if (!cur) throw new Error('unknown run');
      const { run, out } = await fn(structuredClone(cur)); this.runs.set(commit, structuredClone(run)); return out;
    });
  }
  async activeByPlayer(player: string) {
    const l = [...this.runs.values()].filter((r) => r.player.toLowerCase() === player.toLowerCase() && ['ticketed', 'open', 'settling'].includes(r.status));
    return l.length ? structuredClone(l[l.length - 1]) : null;
  }
  async settling() { return [...this.runs.values()].filter((r) => r.status === 'settling').map((r) => structuredClone(r)); }
  async history(player: string, limit: number) {
    return [...this.runs.values()].filter((r) => r.player.toLowerCase() === player.toLowerCase() && r.status === 'settled')
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((r) => structuredClone(r));
  }
  async volume(player: string) {
    return [...this.runs.values()].filter((r) => r.player.toLowerCase() === player.toLowerCase() && ['open', 'settling', 'settled'].includes(r.status)).reduce((a, r) => a + BigInt(r.stake), 0n);
  }
  async putNonce(n: string) { this.nonces.add(n); }
  async useNonce(n: string) { return this.nonces.delete(n); }
  operatorLock<T>(fn: () => Promise<T>) { return this.op.run(fn); }
}
