import { randomBytes } from 'node:crypto';
import { keccak256, type Address, type Hex } from 'viem';
import { authenticate, login, loginMessage, newNonce } from './auth.js';
import type { Chain } from './chain.js';
import type { Cfg } from './config.js';
import { effectiveMaxStake } from './limits.js';
import { cashOut, isPaid, ladderFor, MODE_KEYS, newRun, publicView, rowsOf, stepRun, type RunState } from './engine.js';
import type { Store } from './store.js';

const hex32 = () => ('0x' + randomBytes(32).toString('hex')) as Hex;
const TICKET_TTL = 10 * 60;
const NAMES: Record<number, string> = { 3: 'Soul', 4: 'Ember', 5: 'Frost' };
const fmtEth = (w: bigint) => (Number(w) / 1e18).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';

export function createService(cfg: Cfg, store: Store, chain: Chain) {
  /** Sends the settle transaction exactly once. Safe to call repeatedly: it re-checks the chain first. */
  async function settleOnChain(commit: string) {
    await store.update(commit, async (run) => {
      if (run.status !== 'settling') return { run, out: null };
      const id = BigInt(run.runId!);
      await store.operatorLock(async () => {
        const oc = await chain.onchainRun(id);
        if (oc.status === 2) { run.status = 'settled'; return; }            // an earlier attempt already landed
        if (oc.status !== 1) throw new Error('run is not open on chain');
        run.settleTx = await chain.settle(id, BigInt(run.payout!), run.serverSeed);
        run.status = 'settled';
      });
      return { run, out: null };
    });
  }
  const settleSafe = (commit: string) => settleOnChain(commit).catch((e) => console.error('settle failed, will retry', commit, String(e).slice(0, 200)));
  /** Mode limits as they are right now: the max stake follows the free house pool. */
  async function limits(mode: number) {
    const [mc, free] = await Promise.all([chain.modeCfg(mode), chain.freePool()]);
    return { ...mc, ceiling: mc.maxStake, maxStake: effectiveMaxStake(mode, free, mc.maxStake, mc.minStake, mc.step), freePool: free };
  }
  /** A paid blob is unlocked by HOLDING enough $SOUL right now, or by having WAGERED enough ETH. Either one is enough. */
  async function unlockState(player: Address) {
    const volume = await store.volume(player);
    let bal = 0n, dec = 18;
    try { const r = await chain.soulBalance(player); bal = r.bal; dec = r.dec; } catch (e) { console.error('soul balance read failed', String(e).slice(0, 120)); }
    const owned: Record<number, boolean> = {}, via: Record<number, 'hold' | 'play' | null> = {};
    for (const id of [3, 4, 5]) {
      const byHold = bal >= cfg.hold[id] * 10n ** BigInt(dec), byPlay = volume >= cfg.unlock[id];
      owned[id] = byHold || byPlay; via[id] = byHold ? 'hold' : byPlay ? 'play' : null;
    }
    return { volume, balance: bal / 10n ** BigInt(dec), owned, via };
  }
  const view = async (commit: string) => publicView((await store.get(commit))!);

  return {
    nonce: () => newNonce(store),
    login: (address: string, message: string, signature: Hex) => login(store, cfg.secret, address, message, signature),
    who: (token?: string) => authenticate(cfg.secret, token),
    loginMessage,

    async config() {
      const modes = await Promise.all([0, 1, 2].map(async (m) => {
        const c = await limits(m);
        return { id: m, key: MODE_KEYS[m], rows: rowsOf(m), minStake: c.minStake.toString(), maxStake: c.maxStake.toString(), freePool: c.freePool.toString(), step: c.step.toString(), enabled: c.enabled,
          ladders: Object.fromEntries([0, 3, 4, 5].map((ch) => [ch, ladderFor(m, ch).map((x) => Math.round(x * 100) / 100)])) };
      }));
      return { chainId: cfg.chainId, vault: cfg.vault, operator: chain.operator, modes, unlock: { 3: cfg.unlock[3].toString(), 4: cfg.unlock[4].toString(), 5: cfg.unlock[5].toString() },
        hold: { 3: cfg.hold[3].toString(), 4: cfg.hold[4].toString(), 5: cfg.hold[5].toString() }, soul: cfg.soul };
    },

    async ticket(player: Address, p: { mode: number; character: number; stake: string }) {
      const mode = Number(p.mode), character = Number(p.character);
      if (![0, 1, 2].includes(mode)) throw new Error('bad mode');
      if (!Number.isInteger(character) || character < 0 || character > 5) throw new Error('bad character');
      const stake = BigInt(p.stake);
      const cur = await store.activeByPlayer(player);
      if (cur && cur.status !== 'ticketed') throw new Error('finish your current run first');
      if (cur && cur.status === 'ticketed') {
        const live = cur.ticket && cur.ticket.deadline * 1000 > Date.now() + 30_000;
        if (live && cur.mode === mode && cur.character === character && cur.stake === stake.toString())
          return { ticket: { player, mode, character, stake: cur.stake, commit: cur.commit, deadline: cur.ticket!.deadline }, signature: cur.ticket!.signature, commit: cur.commit };
        await store.update(cur.commit, async (r) => { r.status = 'expired'; return { run: r, out: null }; });
      }
      if (isPaid(character)) {
        const u = await unlockState(player);
        if (!u.owned[character]) throw new Error(`${NAMES[character]} unlocks by holding ${cfg.hold[character].toLocaleString('en-US')} $SOUL or wagering ${fmtEth(cfg.unlock[character])} ETH (you have wagered ${fmtEth(u.volume)})`);
      }
      const mc = await limits(mode);
      if (!mc.enabled) throw new Error('mode is off');
      if (stake > mc.maxStake && stake <= mc.ceiling) throw new Error(`max stake right now is ${fmtEth(mc.maxStake)} ETH. It grows with the house pool.`);
      if (stake < mc.minStake || stake > mc.ceiling || stake % mc.step !== 0n) throw new Error('stake out of range or not a whole step');
      const serverSeed = hex32(), commit = keccak256(serverSeed);
      const deadline = Math.floor(Date.now() / 1000) + TICKET_TTL;
      const signature = await chain.signTicket({ player, mode, character, stake, commit, deadline: BigInt(deadline) });
      const run = newRun({ commit, player, mode, character, stake, serverSeed });
      run.ticket = { deadline, signature };
      await store.insert(run);
      return { ticket: { player, mode, character, stake: stake.toString(), commit, deadline }, signature, commit };
    },

    /** Called by the browser after the player's startRun transaction is mined. Reads the chain, never trusts the client. */
    async confirm(player: Address, txHash: Hex) {
      const ev = await chain.runStarted(txHash);
      if (ev.player.toLowerCase() !== player.toLowerCase()) throw new Error('that run belongs to another wallet');
      const found = await store.get(ev.commit);
      if (!found) throw new Error('unknown ticket');
      await store.update(ev.commit, async (run) => {
        if (run.runId === ev.runId.toString()) return { run, out: null };                // already confirmed
        if (run.status !== 'ticketed') throw new Error('ticket already used or expired');
        if (run.mode !== ev.mode || run.character !== ev.character || run.stake !== ev.stake.toString()) throw new Error('transaction does not match the ticket');
        const oc = await chain.onchainRun(ev.runId);
        if (oc.status !== 1 || oc.commit.toLowerCase() !== run.commit.toLowerCase()) throw new Error('run is not open on chain');
        run.runId = ev.runId.toString(); run.clientSeed = ev.clientSeed; run.maxPayout = oc.maxPayout.toString(); run.status = 'open';
        return { run, out: null };
      });
      return { run: await view(ev.commit) };
    },

    async step(player: Address, col: number, activate = false) {
      const active = await store.activeByPlayer(player);
      if (!active || active.status !== 'open') throw new Error('no open run');
      const result = await store.update(active.commit, async (run) => ({ run, out: stepRun(run, Number(col), !!activate) }));
      if (result.final) await settleSafe(active.commit);
      return { result, run: await view(active.commit) };
    },

    async cashout(player: Address) {
      const active = await store.activeByPlayer(player);
      if (!active || active.status !== 'open') throw new Error('no open run');
      await store.update(active.commit, async (run) => { cashOut(run); return { run, out: null }; });
      await settleSafe(active.commit);
      return { run: await view(active.commit) };
    },

    async current(player: Address) {
      const active = await store.activeByPlayer(player);
      if (active?.status === 'settling') await settleSafe(active.commit);       // opportunistic retry
      const run = active ? await view(active.commit) : null;
      return { run: run && run.status !== 'ticketed' ? run : null };
    },

    async unlocks(player: Address) {
      const u = await unlockState(player);
      return { volume: u.volume.toString(), balance: u.balance.toString(), owned: u.owned, via: u.via,
        thresholds: { 3: cfg.unlock[3].toString(), 4: cfg.unlock[4].toString(), 5: cfg.unlock[5].toString() },
        hold: { 3: cfg.hold[3].toString(), 4: cfg.hold[4].toString(), 5: cfg.hold[5].toString() } };
    },

    async history(player: Address) {
      return (await store.history(player, 20)).map((r) => ({ ...publicView(r), serverSeed: r.serverSeed }));
    },

    async retrySettling() {
      const l = await store.settling();
      for (const r of l) await settleSafe(r.commit);
      return { retried: l.length };
    },
  };
}
export type Service = ReturnType<typeof createService>;
