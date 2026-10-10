import type { Address, Hex } from 'viem';
export interface Cfg { rpc: string; chainId: number; vault: Address; shop: Address; opKey: Hex; secret: string; cronSecret: string; allowedOrigin: string; unlock: Record<number, bigint>; soul: Address; hold: Record<number, bigint> }
const need = (e: Record<string, string | undefined>, k: string) => { const v = e[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
export const loadCfg = (e: Record<string, string | undefined> = process.env): Cfg => ({
  rpc: e.RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com', chainId: Number(e.CHAIN_ID ?? 46630),
  vault: need(e, 'VAULT') as Address, shop: (e.SHOP ?? '0x0000000000000000000000000000000000000000') as Address, opKey: need(e, 'OPERATOR_PRIVATE_KEY') as Hex,
  secret: need(e, 'SESSION_SECRET'), cronSecret: e.CRON_SECRET ?? '', allowedOrigin: e.ALLOWED_ORIGIN ?? '*',
  // holding path: whole $SOUL a wallet must hold. 3 Soul, 4 Ember, 5 Frost
  soul: (e.SOUL_TOKEN ?? '0xA1B60F81a18e42ec71cee5B32FAf09239067a057') as Address,
  hold: { 3: BigInt(e.HOLD_SOUL_TOKENS ?? '6430000'), 4: BigInt(e.HOLD_EMBER_TOKENS ?? '2150000'), 5: BigInt(e.HOLD_FROST_TOKENS ?? '2150000') },
  // total ETH a wallet must have wagered to unlock a character: 3 Soul, 4 Ember, 5 Frost
  unlock: { 3: BigInt(e.UNLOCK_SOUL_WEI ?? '500000000000000000'), 4: BigInt(e.UNLOCK_EMBER_WEI ?? '100000000000000000'), 5: BigInt(e.UNLOCK_FROST_WEI ?? '100000000000000000') },
});
