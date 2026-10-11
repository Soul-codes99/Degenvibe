// DEGEN VIBE game engine. Pure logic, no I/O. Mirrors the balance simulator (degen_vibe_simulator.py),
// so every mode x character keeps the house edge it was calibrated for.
import { keccak256, encodePacked, type Address, type Hex } from 'viem';
import cal from './calibration.json' with { type: 'json' };

export const LADDER = [1.12, 1.34, 1.68, 2.24, 3.30, 4.48, 5.60, 6.72, 7.84, 9.41, 11.8, 15.7, 23.5,
  31.4, 39.2, 47.0, 54.9, 65.9, 82.3, 110, 165, 220, 274, 329, 384];
export const MODE_KEYS = ['safe', 'trencher', 'degen'] as const;
// 0 Nova, 1 Tank, 2 Zen are free. 3 Soul, 4 Ember, 5 Frost are sold in the shop.
export const CHAR_KEY: Record<number, string> = { 0: 'free', 1: 'free', 2: 'free', 3: 'soul_t0', 4: 'ember_t0', 5: 'frost_t0' };
export const isPaid = (c: number) => c >= 3 && c <= 5;
const CP_LOSS: (number | null)[] = [0.2, 0.8, null];       // share of run value lost on a trap after a checkpoint
const CP_EVERY = 3, CP_CHANCE = 0.3, EMBER_PEN = 0.5, ACT_MIN = 3, REVIVE_LOSS = 0.5;
const WIDTHS = [2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7];

export type Status = 'ticketed' | 'open' | 'settling' | 'settled' | 'expired';
export interface RunState {
  commit: Hex; player: Address; mode: number; character: number; stake: string;   // wei as decimal string
  status: Status; serverSeed: Hex; clientSeed: Hex; runId?: string; maxPayout: string;
  ticket?: { deadline: number; signature: Hex };
  k: number; cp: boolean; D: number; au: boolean; fz: number; pn: number; rv: boolean; burnt: number[];
  history: { row: number; col: number; kind: string; mult: number }[];
  result?: 'cash' | 'trap' | 'summit' | 'capped'; payout?: string; settleTx?: Hex; createdAt: number;
}
type Rand = (tag: string, a: number, b: number) => number;

const M = (mode: number) => (cal as any)[MODE_KEYS[mode]] as { edge: number; rows: number; trap_scale_g: number; chars: Record<string, { ladder_scale_f: number }> };
export const rowsOf = (mode: number) => M(mode).rows;
export const trapProb = (mode: number, k: number) => {
  const e = M(mode).edge;
  const q = k === 0 ? 1 - (1 - e) / LADDER[0] : 1 - LADDER[k - 1] / LADDER[k];
  return Math.min(1, q * M(mode).trap_scale_g);
};
export const ladderFor = (mode: number, character: number) => {
  const f = M(mode).chars[CHAR_KEY[character]].ladder_scale_f;
  return LADDER.slice(0, rowsOf(mode)).map((x) => 1 + f * (x - 1));
};
export const abilityOf = (c: number): 'frost' | 'ember' | 'soul' | null => (c === 5 ? 'frost' : c === 4 ? 'ember' : c === 3 ? 'soul' : null);

export const hashRand = (r: Pick<RunState, 'serverSeed' | 'clientSeed'>): Rand => (tag, a, b) => {
  const h = keccak256(encodePacked(['bytes32', 'bytes32', 'string', 'uint16', 'uint16'], [r.serverSeed, r.clientSeed, tag, a, b]));
  return Number(BigInt(h) >> 208n) / 2 ** 48;       // 48 bits of the hash as a fraction in [0,1)
};
export const widthOf = (r: RunState, row: number, rand: Rand = hashRand(r)) => WIDTHS[Math.floor(rand('w', row, 0) * WIDTHS.length)];

export const newRun = (p: { commit: Hex; player: Address; mode: number; character: number; stake: bigint; serverSeed: Hex }): RunState => ({
  commit: p.commit, player: p.player, mode: p.mode, character: p.character, stake: p.stake.toString(), status: 'ticketed',
  serverSeed: p.serverSeed, clientSeed: ('0x' + '00'.repeat(32)) as Hex, maxPayout: '0',
  k: 0, cp: false, D: 0, au: abilityOf(p.character) === 'frost' || abilityOf(p.character) === 'ember', fz: 0, pn: 0,
  rv: abilityOf(p.character) === 'soul', burnt: [], history: [], createdAt: Date.now(),
});

export const multOf = (r: RunState) => (r.k === 0 ? 1 : Math.max(0, ladderFor(r.mode, r.character)[r.k - 1] - r.D));
export const mulWei = (stake: bigint, mult: number) => (stake * BigInt(Math.floor(mult * 1e6))) / 1_000_000n;   // rounds down
const cap = (r: RunState, v: bigint) => (v > BigInt(r.maxPayout) ? BigInt(r.maxPayout) : v);
export const potentialWei = (r: RunState) => (r.k === 0 ? 0n : cap(r, mulWei(BigInt(r.stake), multOf(r))));

export type StepKind = 'safe' | 'cp' | 'trap' | 'revived' | 'capped' | 'summit';
export interface StepResult { kind: StepKind; col: number; final: boolean; mult: number }

/** Resolve one tile tap. Mutates the run. Throws on illegal moves so the server never trusts the client. */
export function stepRun(r: RunState, col: number, activate: boolean, rand: Rand = hashRand(r)): StepResult {
  if (r.status !== 'open') throw new Error('run is not open');
  const rows = rowsOf(r.mode), k = r.k;
  if (!Number.isInteger(col) || col < 0 || col >= widthOf(r, k, rand)) throw new Error('bad tile');
  if (r.burnt.includes(col)) throw new Error('tile already burnt');
  const ab = abilityOf(r.character);
  if (activate) {
    if (ab !== 'frost' && ab !== 'ember') throw new Error('no ability to activate');
    if (!r.au || r.fz > 0) throw new Error('ability not available');
    if (k < ACT_MIN) throw new Error(`ability unlocks from floor ${ACT_MIN + 1}`);
    r.au = false; r.fz = 1; r.pn = ab === 'ember' ? 2 : 0;
  }
  const lad = ladderFor(r.mode, r.character);
  const mult = multOf(r);
  const trap = r.fz === 0 && rand('t', k, col) < trapProb(r.mode, k);
  if (trap) {
    if (r.rv) {                                            // Soul: one free revival, costs half the run value
      r.rv = false; r.D += REVIVE_LOSS * mult; r.burnt.push(col);
      r.history.push({ row: k, col, kind: 'revived', mult: multOf(r) });
      return { kind: 'revived', col, final: false, mult: multOf(r) };
    }
    const cpl = CP_LOSS[r.mode];
    r.history.push({ row: k, col, kind: 'trap', mult });
    r.status = 'settling'; r.result = 'trap';
    r.payout = (r.cp && cpl != null ? cap(r, mulWei(BigInt(r.stake), mult * (1 - cpl))) : 0n).toString();
    return { kind: 'trap', col, final: true, mult };
  }
  const gain = lad[k] - (k === 0 ? 1 : lad[k - 1]);
  if (r.pn > 0) r.D += gain * EMBER_PEN;
  const cpl = CP_LOSS[r.mode];
  const cpHit = cpl != null && (k + 1) % CP_EVERY === 0 && rand('c', k, col) < CP_CHANCE;
  if (cpHit) r.cp = true;
  r.fz = Math.max(0, r.fz - 1); r.pn = Math.max(0, r.pn - 1); r.k = k + 1; r.burnt = [];
  const m2 = multOf(r);
  r.history.push({ row: k, col, kind: cpHit ? 'cp' : 'safe', mult: m2 });
  const pot = mulWei(BigInt(r.stake), m2);
  if (pot >= BigInt(r.maxPayout)) { r.status = 'settling'; r.result = 'capped'; r.payout = r.maxPayout; return { kind: 'capped', col, final: true, mult: m2 }; }
  if (r.k >= rows) { r.status = 'settling'; r.result = 'summit'; r.payout = pot.toString(); return { kind: 'summit', col, final: true, mult: m2 }; }
  return { kind: cpHit ? 'cp' : 'safe', col, final: false, mult: m2 };
}

export function cashOut(r: RunState) {
  if (r.status !== 'open') throw new Error('run is not open');
  if (r.k === 0) throw new Error('climb at least one floor first');
  r.status = 'settling'; r.result = 'cash'; r.payout = potentialWei(r).toString();
}

/** What the browser may see. Never the server seed until the run is settled. */
export function publicView(r: RunState) {
  const rows = rowsOf(r.mode), ab = abilityOf(r.character);
  const open = r.status !== 'ticketed' && r.status !== 'expired';
  const rand = hashRand(r);
  return {
    status: r.status, runId: r.runId, commit: r.commit, mode: r.mode, character: r.character, stake: r.stake, maxPayout: r.maxPayout,
    rows, floor: r.k, mult: multOf(r), potential: potentialWei(r).toString(), checkpoint: r.cp, burnt: r.burnt,
    widths: open ? Array.from({ length: rows }, (_, i) => widthOf(r, i, rand)) : [],
    ladder: ladderFor(r.mode, r.character).map((x) => Math.round(x * 100) / 100),
    ability: ab ? { kind: ab, canActivate: (ab === 'frost' || ab === 'ember') && r.au && r.fz === 0 && r.k >= ACT_MIN, reviveLeft: ab === 'soul' ? r.rv : undefined } : null,
    history: r.history, result: r.result, payout: r.payout, settleTx: r.settleTx,
    clientSeed: open ? r.clientSeed : undefined, serverSeed: r.status === 'settled' ? r.serverSeed : undefined,
  };
}
