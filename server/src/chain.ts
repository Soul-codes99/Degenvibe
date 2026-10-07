import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEventLogs, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Cfg } from './config.js';

const vaultAbi = parseAbi([
  'event RunStarted(uint256 indexed runId, address indexed player, uint8 mode, uint8 character, uint256 stake, bytes32 commit, bytes32 clientSeed, uint256 maxPayout)',
  'function runs(uint256) view returns (address player, uint128 stake, uint128 fee, uint128 maxPayout, uint128 exposure, uint64 startedAt, uint8 mode, uint8 status, bytes32 commit)',
  'function modes(uint8) view returns (uint128 minStake, uint128 maxStake, uint128 step, uint16 feeBps, uint32 topMultX100, bool enabled)',
  'function settle(uint256 id, uint256 payout, bytes32 seed)',
]);
const shopAbi = parseAbi(['function owns(address player, uint8 id) view returns (bool)']);

export function makeChain(cfg: Cfg) {
  const chain = defineChain({ id: cfg.chainId, name: 'robinhood-testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } });
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const account = privateKeyToAccount(cfg.opKey);
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpc) });
  return {
    operator: account.address,
    signTicket: (m: { player: Address; mode: number; character: number; stake: bigint; commit: Hex; deadline: bigint }) =>
      account.signTypedData({
        domain: { name: 'DegenVibeVault', version: '1', chainId: cfg.chainId, verifyingContract: cfg.vault },
        types: { Ticket: [{ name: 'player', type: 'address' }, { name: 'mode', type: 'uint8' }, { name: 'character', type: 'uint8' }, { name: 'stake', type: 'uint128' }, { name: 'commit', type: 'bytes32' }, { name: 'deadline', type: 'uint64' }] },
        primaryType: 'Ticket', message: m,
      }),
    owns: (p: Address, id: number) => pub.readContract({ address: cfg.shop, abi: shopAbi, functionName: 'owns', args: [p, id] }),
    modeCfg: async (m: number) => { const [minStake, maxStake, step, feeBps, topMultX100, enabled] = await pub.readContract({ address: cfg.vault, abi: vaultAbi, functionName: 'modes', args: [m] }); return { minStake, maxStake, step, feeBps, topMultX100, enabled }; },
    runStarted: async (hash: Hex) => {
      const r = await pub.getTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('transaction failed');
      const logs = parseEventLogs({ abi: vaultAbi, eventName: 'RunStarted', logs: r.logs.filter((l) => l.address.toLowerCase() === cfg.vault.toLowerCase()) });
      if (!logs.length) throw new Error('no RunStarted event in that transaction');
      return logs[0].args;
    },
    onchainRun: async (id: bigint) => { const [player, stake, fee, maxPayout, exposure, startedAt, mode, status, commit] = await pub.readContract({ address: cfg.vault, abi: vaultAbi, functionName: 'runs', args: [id] }); return { player, stake, fee, maxPayout, exposure, startedAt, mode, status, commit }; },
    settle: async (id: bigint, payout: bigint, seed: Hex) => {
      const hash = await wallet.writeContract({ address: cfg.vault, abi: vaultAbi, functionName: 'settle', args: [id, payout, seed] });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== 'success') throw new Error('settle reverted');
      return hash;
    },
  };
}
export type Chain = ReturnType<typeof makeChain>;
