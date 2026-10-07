import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Hex } from 'viem';
import { abilityOf, cashOut, ladderFor, multOf, newRun, publicView, stepRun, LADDER, trapProb, rowsOf, hashRand, type RunState } from '../src/engine.ts';

const ETH = 10n ** 18n;
const hex32 = () => ('0x' + randomBytes(32).toString('hex')) as Hex;
const mk = (mode: number, character: number, maxPayout = 10n ** 30n): RunState => {
  const r = newRun({ commit: hex32(), player: '0x0000000000000000000000000000000000000001', mode, character, stake: ETH, serverSeed: hex32() });
  r.status = 'open'; r.maxPayout = maxPayout.toString(); r.clientSeed = hex32(); return r;
};
/** Forced randomness: safe tiles, no checkpoints, 5 wide rows, unless told otherwise. */
const rig = (o: { trap?: (k: number, c: number) => boolean; cp?: (k: number) => boolean } = {}) => (tag: string, a: number, b: number) =>
  tag === 't' ? (o.trap?.(a, b) ? 0 : 0.999999) : tag === 'c' ? (o.cp?.(a) ? 0 : 0.999999) : 0.5;

test('safe climb follows the published ladder for free characters', () => {
  const r = mk(2, 0); const R = rig();
  for (let i = 0; i < 3; i++) stepRun(r, 0, false, R);
  assert.equal(r.k, 3); assert.ok(Math.abs(multOf(r) - LADDER[2]) < 1e-9);
  assert.deepEqual(ladderFor(2, 0), LADDER.slice(0, 25));
});

test('trap without checkpoint pays nothing and locks the run', () => {
  const r = mk(2, 0); stepRun(r, 0, false, rig());
  const s = stepRun(r, 1, false, rig({ trap: () => true }));
  assert.equal(s.kind, 'trap'); assert.equal(r.status, 'settling'); assert.equal(r.payout, '0');
  assert.throws(() => stepRun(r, 0, false, rig()), /not open/);
});

test('checkpoint softens a later trap: Safe keeps 80%, Trencher keeps 20%', () => {
  for (const [mode, keep] of [[0, 0.8], [1, 0.2]] as const) {
    const r = mk(mode, 0); const R = rig({ cp: (k) => k === 2 });
    for (let i = 0; i < 3; i++) stepRun(r, 0, false, R);
    assert.equal(r.cp, true);
    const m = multOf(r);
    stepRun(r, 0, false, rig({ trap: () => true }));
    const got = Number(BigInt(r.payout!) * 1_000_000n / ETH) / 1e6;
    assert.ok(Math.abs(got - m * keep) < 2e-6, `payout ${got} vs ${m * keep}`);
  }
});

test('Degen has no checkpoints even if the dice say so', () => {
  const r = mk(2, 0); const R = rig({ cp: () => true });
  for (let i = 0; i < 6; i++) stepRun(r, 0, false, R);
  assert.equal(r.cp, false);
});

test('Soul revives once, loses half the run value, cannot retry the burnt tile', () => {
  const r = mk(2, 3); const safe = rig(); const trap = rig({ trap: () => true });
  stepRun(r, 0, false, safe); stepRun(r, 0, false, safe);
  const before = multOf(r);
  const s = stepRun(r, 2, false, trap);
  assert.equal(s.kind, 'revived'); assert.equal(r.k, 2); assert.equal(r.status, 'open');
  assert.ok(Math.abs(multOf(r) - before * 0.5) < 1e-9);
  assert.throws(() => stepRun(r, 2, false, safe), /burnt/);
  assert.equal(stepRun(r, 3, false, trap).kind, 'trap');           // the second trap is final
  assert.equal(r.status, 'settling');
});

test('Frost: locked before floor 4, guaranteed safe floor, once per run', () => {
  const r = mk(2, 5); const safe = rig(); const trap = rig({ trap: () => true });
  assert.throws(() => stepRun(r, 0, true, safe), /unlocks from floor/);
  for (let i = 0; i < 3; i++) stepRun(r, 0, false, safe);
  assert.equal(publicView(r).ability?.canActivate, true);
  assert.equal(stepRun(r, 0, true, trap).kind, 'safe');             // frozen floor ignores the trap roll
  assert.equal(r.k, 4);
  assert.throws(() => stepRun(r, 0, true, safe), /not available/);
  assert.equal(stepRun(r, 0, false, trap).kind, 'trap');
});

test('Ember: disarms one floor and halves the multiplier gain on the next two floors', () => {
  const r = mk(2, 4); const safe = rig(); const trap = rig({ trap: () => true });
  for (let i = 0; i < 3; i++) stepRun(r, 0, false, safe);
  const lad = ladderFor(2, 4), base = lad[2];
  stepRun(r, 0, true, trap);                                         // floor 4, disarmed
  stepRun(r, 0, false, safe);                                        // floor 5, still penalised
  stepRun(r, 0, false, safe);                                        // floor 6, back to normal
  const pen = 0.5 * ((lad[3] - lad[2]) + (lad[4] - lad[3]));
  assert.ok(Math.abs(multOf(r) - (lad[5] - pen)) < 1e-9);
  assert.ok(base > 1);
});

test('abilities are refused for characters that do not have them', () => {
  assert.throws(() => stepRun(mk(2, 0), 0, true, rig()), /no ability/);
  assert.throws(() => stepRun(mk(2, 3), 0, true, rig()), /no ability/);
});

test('pool cap ends the run at maxPayout, summit ends at the top row', () => {
  const r = mk(2, 0, ETH * 2n); const R = rig();
  let last; for (let i = 0; i < 6; i++) { last = stepRun(r, 0, false, R); if (last.final) break; }
  assert.equal(last!.kind, 'capped'); assert.equal(r.payout, (ETH * 2n).toString());
  const s = mk(0, 0); const R2 = rig(); let end;
  for (let i = 0; i < rowsOf(0); i++) end = stepRun(s, 0, false, R2);
  assert.equal(end!.kind, 'summit'); assert.equal(s.k, 12);
});

test('cash out needs one safe floor and is final', () => {
  const r = mk(1, 0); assert.throws(() => cashOut(r), /at least one floor/);
  stepRun(r, 0, false, rig()); cashOut(r);
  assert.equal(r.status, 'settling'); assert.equal(r.result, 'cash');
  assert.throws(() => cashOut(r), /not open/);
});

test('illegal tiles are rejected', () => {
  const r = mk(2, 0);
  assert.throws(() => stepRun(r, -1, false, rig()), /bad tile/);
  assert.throws(() => stepRun(r, 99, false, rig()), /bad tile/);
  assert.throws(() => stepRun(r, 1.5, false, rig()), /bad tile/);
});

test('the browser never sees the seed before settlement, and tiles are deterministic', () => {
  const r = mk(2, 0); r.status = 'ticketed';
  assert.equal(publicView(r).serverSeed, undefined); assert.deepEqual(publicView(r).widths, []);
  r.status = 'open'; assert.equal(publicView(r).serverSeed, undefined); assert.equal(publicView(r).widths.length, 25);
  const a = hashRand(r), b = hashRand({ ...r }); assert.equal(a('t', 3, 2), b('t', 3, 2));
  assert.notEqual(a('t', 3, 2), hashRand({ ...r, clientSeed: hex32() })('t', 3, 2));
  r.status = 'settled'; assert.equal(publicView(r).serverSeed, r.serverSeed);
});

// ---- Monte Carlo: the live engine must keep each mode's house edge against simple fixed strategies ----
type Plan = { cashRow: number; useAbility: boolean };
function play(mode: number, character: number, plan: Plan, maxPayout = 10n ** 30n) {
  const r = mk(mode, character, maxPayout);
  while (r.status === 'open') {
    if (r.k >= plan.cashRow) { cashOut(r); break; }
    const ab = abilityOf(r.character);
    const act = plan.useAbility && (ab === 'frost' || ab === 'ember') && r.au && r.fz === 0 && r.k >= 3;
    stepRun(r, r.burnt.includes(0) ? 1 : 0, act);          // after a Soul revive the burnt tile is off limits
  }
  return Number(BigInt(r.payout!) * 1_000_000n / ETH) / 1e6;
}
const EDGE = [0.05, 0.05, 0.04];
for (const [mode, name] of [[0, 'Safe'], [1, 'Trencher'], [2, 'Degen']] as const) {
  for (const [character, cname] of [[0, 'free'], [3, 'Soul'], [4, 'Ember'], [5, 'Frost']] as const) {
    test(`RTP check ${name} / ${cname}: the house keeps its edge`, () => {
      for (const cashRow of [2, 5]) {
        const N = 8000; let s = 0, s2 = 0;
        for (let i = 0; i < N; i++) { const v = play(mode, character, { cashRow, useAbility: true }); s += v; s2 += v * v; }
        const m = s / N, se = Math.sqrt(Math.max(0, s2 / N - m * m) / N), target = 1 - EDGE[mode];
        assert.ok(m <= target + 4 * se + 0.01, `${name}/${cname} cash@${cashRow}: RTP ${m.toFixed(4)} is above ${target}`);
        if (character === 0 && mode === 2) assert.ok(Math.abs(m - target) <= 4 * se + 0.01, `Degen free cash@${cashRow}: ${m.toFixed(4)} should be ${target}`);
      }
    });
  }
}
test('hidden trap odds stay below 1 and the first floor matches the ladder maths', () => {
  for (const m of [0, 1, 2]) for (let k = 0; k < rowsOf(m); k++) assert.ok(trapProb(m, k) > 0 && trapProb(m, k) < 1);
  assert.ok(Math.abs(trapProb(2, 0) - (1 - 0.96 / 1.12)) < 1e-9);
});
