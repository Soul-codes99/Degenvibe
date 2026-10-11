/** Stake caps that grow with the house pool. A wallet can stake at most a fixed share of the FREE pool
 *  (pool minus what open runs have reserved), never more than the on-chain ceiling for the mode,
 *  never less than the minimum stake. Shares at a 0.05 ETH pool reproduce the launch limits. */
export const STAKE_SHARE_BPS: Record<number, bigint> = { 0: 100n, 1: 200n, 2: 400n };   // Safe 1%, Trencher 2%, Degen 4%

export function effectiveMaxStake(mode: number, freePool: bigint, ceiling: bigint, minStake: bigint, step: bigint): bigint {
  let v = (freePool * STAKE_SHARE_BPS[mode]) / 10_000n;
  if (v > ceiling) v = ceiling;
  v -= v % step;                       // whole steps only
  return v < minStake ? minStake : v;
}
