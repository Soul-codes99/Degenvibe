import type { Address, Hex } from 'viem';
export interface Cfg { rpc: string; chainId: number; vault: Address; shop: Address; opKey: Hex; secret: string; cronSecret: string; allowedOrigin: string }
const need = (e: Record<string, string | undefined>, k: string) => { const v = e[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
export const loadCfg = (e: Record<string, string | undefined> = process.env): Cfg => ({
  rpc: e.RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com', chainId: Number(e.CHAIN_ID ?? 46630),
  vault: need(e, 'VAULT') as Address, shop: need(e, 'SHOP') as Address, opKey: need(e, 'OPERATOR_PRIVATE_KEY') as Hex,
  secret: need(e, 'SESSION_SECRET'), cronSecret: e.CRON_SECRET ?? '', allowedOrigin: e.ALLOWED_ORIGIN ?? '*',
});
