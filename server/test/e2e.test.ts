// End to end against a local anvil chain with the REAL deployed vault and shop (see scripts/e2e.sh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createService } from '../src/service.ts';
import { makeChain } from '../src/chain.ts';
import { handle } from '../src/http.ts';
import { boot } from '../src/runtime.ts';

const E = process.env as Record<string, string>;
const KEYS = { dep: E.DEPLOYER_KEY as Hex, p1: E.PLAYER1_KEY as Hex, p2: E.PLAYER2_KEY as Hex };
const { cfg, store, svc } = boot({ RPC_URL: E.RPC_URL, CHAIN_ID: E.CHAIN_ID, VAULT: E.VAULT, SHOP: E.SHOP, OPERATOR_PRIVATE_KEY: E.OPERATOR_KEY, SESSION_SECRET: 'test-secret', DATABASE_URL: E.DATABASE_URL });
const chain = defineChain({ id: Number(E.CHAIN_ID), name: 'anvil', nativeCurrency: { name: 'E', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [E.RPC_URL] } } });
const pub = createPublicClient({ chain, transport: http() });
const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain, transport: http() });
const vaultAbi = parseAbi([
  'function startRun((address player,uint8 mode,uint8 character,uint128 stake,bytes32 commit,uint64 deadline) t, bytes sig, bytes32 clientSeed) payable',
  'function pool() view returns (uint256)', 'function escrow() view returns (uint256)', 'function reserved() view returns (uint256)',
  'function totalClaimable() view returns (uint256)', 'function treasuryAccrued() view returns (uint256)',
  'event RunSettled(uint256 indexed runId, address indexed player, uint256 payout, bytes32 seed)',
]);
const tokenAbi = parseAbi(['function mint(address to, uint256 a)', 'function approve(address,uint256) returns (bool)']);
const shopAbi = parseAbi(['function unlock(uint8 id)']);
const vault = E.VAULT as Hex;
const call = (method: string, path: string, body?: any, token?: string) => handle(svc, cfg, { method, path, headers: token ? { authorization: `Bearer ${token}` } : {}, body });
const ok = async (method: string, path: string, body?: any, token?: string) => { const r = await call(method, path, body, token); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body as any; };
const bad = async (method: string, path: string, body: any, token: string | undefined, re: RegExp) => { const r = await call(method, path, body, token); assert.notEqual(r.status, 200); assert.match((r.body as any).error, re); };
const rnd = () => ('0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')) as Hex;

async function signIn(key: Hex, service = svc) {
  const w = wallet(key); const addr = w.account.address;
  const n = await ok('GET', '/api/nonce');
  const message = service.loginMessage(addr, n.nonce, n.issued);
  const signature = await w.signMessage({ message });
  const out = await ok('POST', '/api/login', { address: addr, message, signature });
  return { token: out.token as string, addr, message, signature };
}
async function startRun(key: Hex, token: string, mode: number, character: number, stake: bigint) {
  const w = wallet(key);
  const t = await ok('POST', '/api/ticket', { mode, character, stake: stake.toString() }, token);
  const tx = await w.writeContract({ address: vault, abi: vaultAbi, functionName: 'startRun', value: stake,
    args: [{ player: w.account.address, mode, character, stake, commit: t.ticket.commit, deadline: BigInt(t.ticket.deadline) }, t.signature, rnd()] });
  await pub.waitForTransactionReceipt({ hash: tx });
  const c = await ok('POST', '/api/confirm', { txHash: tx }, token);
  return { run: c.run, tx, ticket: t };
}
async function checkBooks() {
  const [pool, escrow, reserved, claimable, accrued, bal] = await Promise.all(['pool', 'escrow', 'reserved', 'totalClaimable', 'treasuryAccrued'].map((f) => pub.readContract({ address: vault, abi: vaultAbi, functionName: f as any }) as Promise<bigint>).concat(pub.getBalance({ address: vault })));
  assert.equal(bal, pool + escrow + claimable + accrued, 'vault balance must equal its books');
  assert.ok(reserved <= pool, 'reserved must never exceed the pool');
}
async function settledPayout(runId: string): Promise<bigint> {
  const logs = await pub.getContractEvents({ address: vault, abi: vaultAbi, eventName: 'RunSettled', args: { runId: BigInt(runId) }, fromBlock: 0n });
  assert.equal(logs.length, 1, 'exactly one settlement per run'); return logs[0].args.payout!;
}
/** Climb until a trap, or cash out after `cashRow` floors. Returns the final run view. */
async function climb(token: string, cashRow: number, useAbility = true) {
  for (let guard = 0; guard < 40; guard++) {
    const cur = (await ok('GET', '/api/run', undefined, token)).run;
    if (cur.status === 'settled') return cur;
    if (cur.floor >= cashRow && cur.floor > 0) return (await ok('POST', '/api/cashout', undefined, token)).run;
    const col = cur.burnt.includes(0) ? 1 : 0;
    const r = await ok('POST', '/api/step', { col, activate: useAbility && cur.ability?.canActivate === true }, token);
    if (r.run.status === 'settled') return r.run;
  }
  throw new Error('run did not finish');
}
const verifyFinished = async (v: any) => {
  assert.equal(v.status, 'settled'); assert.equal(keccak256(v.serverSeed), v.commit, 'revealed seed must hash to the commit');
  assert.equal(await settledPayout(v.runId), BigInt(v.payout), 'on-chain payout equals the server result');
  await checkBooks();
};

test('wallet login: signature required, nonce is single use, tokens are checked', async () => {
  await bad('POST', '/api/ticket', { mode: 0, character: 0, stake: '100' }, undefined, /not signed in/);
  await bad('POST', '/api/ticket', { mode: 0, character: 0, stake: '100' }, 'forged.token', /not signed in/);
  const a = await signIn(KEYS.p1);
  await bad('POST', '/api/login', { address: a.addr, message: a.message, signature: a.signature }, undefined, /nonce/);
  const n = await ok('GET', '/api/nonce'); const msg = svc.loginMessage(a.addr, n.nonce, n.issued);
  const wrong = await wallet(KEYS.p2).signMessage({ message: msg });
  await bad('POST', '/api/login', { address: a.addr, message: msg, signature: wrong }, undefined, /bad signature/);
});

test('full runs in every mode: ticket, one player transaction, free moves, cash out or trap, verified settlement', async () => {
  const { token } = await signIn(KEYS.p1);
  const seen = new Set<string>();
  for (const [mode, stake] of [[0, parseEther('0.0002')], [1, parseEther('0.0004')], [2, parseEther('0.0005')], [0, parseEther('0.0001')], [1, parseEther('0.0002')], [2, parseEther('0.0005')]] as const) {
    for (let i = 0; i < 4; i++) {
      const { run } = await startRun(KEYS.p1, token, mode, i % 3, stake);
      assert.equal(run.status, 'open'); assert.equal(run.serverSeed, undefined, 'seed stays secret while open');
      const done = await climb(token, 2 + i);
      seen.add(done.result); await verifyFinished(done);
      await bad('POST', '/api/cashout', undefined, token, /no open run/);
      await bad('POST', '/api/step', { col: 0 }, token, /no open run/);
    }
  }
  assert.ok(seen.has('trap') && seen.has('cash'), `expected both traps and cash outs, saw ${[...seen]}`);
});

test('tickets: cannot be tampered, replayed, stolen or exceed stake rules', async () => {
  const a = await signIn(KEYS.p1), b = await signIn(KEYS.p2);
  await bad('POST', '/api/ticket', { mode: 0, character: 0, stake: parseEther('0.01').toString() }, a.token, /stake out of range/);
  await bad('POST', '/api/ticket', { mode: 0, character: 0, stake: parseEther('0.00015').toString() }, a.token, /whole step/);
  await bad('POST', '/api/ticket', { mode: 7, character: 0, stake: '1' }, a.token, /bad mode/);
  const stake = parseEther('0.0003'); const t = await ok('POST', '/api/ticket', { mode: 0, character: 0, stake: stake.toString() }, a.token);
  const w = wallet(KEYS.p1);
  const send = (over: any, value = stake, from = w) => from.writeContract({ address: vault, abi: vaultAbi, functionName: 'startRun', value,
    args: [{ player: from.account.address, mode: 0, character: 0, stake, commit: t.ticket.commit, deadline: BigInt(t.ticket.deadline), ...over }, t.signature, rnd()] });
  await assert.rejects(send({ stake: parseEther('0.0005') }, parseEther('0.0005')), 'tampered stake');
  await assert.rejects(send({ character: 3 }), 'tampered character');
  await assert.rejects(send({}, stake, wallet(KEYS.p2)), 'ticket belongs to player 1');
  const hash = await send({}); await pub.waitForTransactionReceipt({ hash });
  await assert.rejects(send({}), 'replayed commit');
  await bad('POST', '/api/confirm', { txHash: hash }, b.token, /another wallet/);
  await ok('POST', '/api/confirm', { txHash: hash }, a.token);
  await ok('POST', '/api/confirm', { txHash: hash }, a.token);            // idempotent
  await bad('POST', '/api/ticket', { mode: 0, character: 0, stake: stake.toString() }, a.token, /finish your current run/);
  await verifyFinished(await climb(a.token, 1));
});

test('shop: locked characters need a purchase, then abilities work and settle correctly', async () => {
  const { token, addr } = await signIn(KEYS.p1); const w = wallet(KEYS.p1), dep = wallet(KEYS.dep);
  await bad('POST', '/api/ticket', { mode: 2, character: 4, stake: parseEther('0.0005').toString() }, token, /locked/);
  await dep.writeContract({ address: E.SOUL as Hex, abi: tokenAbi, functionName: 'mint', args: [addr, parseEther('20000000')] });
  await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: E.SOUL as Hex, abi: tokenAbi, functionName: 'approve', args: [E.SHOP as Hex, parseEther('20000000')] }) });
  for (const id of [3, 4, 5]) await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: E.SHOP as Hex, abi: shopAbi, functionName: 'unlock', args: [id] }) });
  const used: string[] = [];
  for (const character of [4, 5, 3, 4, 5, 3, 4, 5]) {
    const { run } = await startRun(KEYS.p1, token, 2, character, parseEther('0.0005'));
    assert.equal(run.ability.kind, ['soul', 'ember', 'frost'][character - 3]);
    const done = await climb(token, 6); used.push(done.history.map((h: any) => h.kind).join(','));
    await verifyFinished(done);
  }
  assert.ok(used.length === 8);
});

test('pool-gated payout cap is read from the chain and enforced', async () => {
  const { token } = await signIn(KEYS.p1);
  const stake = parseEther('0.002');
  const [pool, reserved] = await Promise.all(['pool', 'reserved'].map((f) => pub.readContract({ address: vault, abi: vaultAbi, functionName: f as any }) as Promise<bigint>));
  const expected = ((pool - reserved) * 2000n) / 10000n;                       // payoutCapBps = 2000 from the deploy script
  assert.ok(expected < stake * 384n, 'the pool cap, not the 384x ladder top, must be the binding limit');
  const { run } = await startRun(KEYS.p1, token, 2, 0, stake);
  assert.equal(BigInt(run.maxPayout), expected);
  const done = await climb(token, 3);
  assert.ok(BigInt(done.payout) <= expected, 'payout never exceeds the cap');
  await verifyFinished(done);
});

test('double cash-out race: five parallel requests, exactly one settlement', async () => {
  const { token } = await signIn(KEYS.p1);
  for (let attempt = 0; attempt < 12; attempt++) {
    const { run } = await startRun(KEYS.p1, token, 0, 0, parseEther('0.0002'));
    let cur = run;
    while (cur.floor < 1 && cur.status === 'open') cur = (await ok('POST', '/api/step', { col: 0 }, token)).run;
    if (cur.status !== 'open') { await verifyFinished(cur); continue; }       // hit a trap, try again
    const res = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/cashout', undefined, token)));
    assert.equal(res.filter((r) => r.status === 200).length, 1, 'only one cash-out may succeed');
    const done = (await ok('GET', '/api/history', undefined, token))[0];
    await verifyFinished(done); return;
  }
  assert.fail('could not get a safe first floor in 12 tries');
});

test('settlement outage: run stays "settling", then recovers without double paying', async () => {
  const { token } = await signIn(KEYS.p1);
  const real = makeChain(cfg); let fail = true;
  const flaky = createService(cfg, store, { ...real, settle: async (...a: Parameters<typeof real.settle>) => { if (fail) { fail = false; throw new Error('rpc down'); } return real.settle(...a); } });
  await startRun(KEYS.p1, token, 0, 0, parseEther('0.0002'));
  const addr = wallet(KEYS.p1).account.address; let final: any;
  for (let i = 0; i < 30 && !final; i++) {
    const cur = (await flaky.current(addr)).run!;
    const r = await flaky.step(addr, cur.burnt.includes(0) ? 1 : 0, false);
    if (r.result.final) final = r.run;
  }
  assert.equal(final.status, 'settling', 'first settle attempt failed, run waits');
  const retry = await flaky.retrySettling(); assert.equal(retry.retried, 1);
  const done = (await ok('GET', '/api/history', undefined, token))[0];
  await verifyFinished(done);
  assert.equal((await flaky.retrySettling()).retried, 0);
});

test('history exposes everything needed to verify fairness', async () => {
  const { token } = await signIn(KEYS.p1);
  const h = await ok('GET', '/api/history', undefined, token);
  assert.ok(h.length > 5);
  for (const r of h) { assert.equal(keccak256(r.serverSeed), r.commit); assert.ok(r.clientSeed); }
  await checkBooks();
});
