import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { recoverMessageAddress, getAddress, type Address, type Hex } from 'viem';
import type { Store } from './store.js';

export const loginMessage = (address: string, nonce: string, issued: string) =>
  `DEGEN VIBE login (testnet only)\nAddress: ${address}\nNonce: ${nonce}\nIssued: ${issued}`;
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url');

export async function newNonce(store: Store) { const n = randomBytes(16).toString('hex'); await store.putNonce(n); return n; }

/** One signature per session. Returns a stateless HMAC token valid for 12 hours. */
export async function login(store: Store, secret: string, address: string, message: string, signature: Hex) {
  const m = /^DEGEN VIBE login \(testnet only\)\nAddress: (0x[0-9a-fA-F]{40})\nNonce: ([0-9a-f]{32})\nIssued: (.+)$/.exec(message);
  if (!m) throw new Error('bad login message');
  if (m[1].toLowerCase() !== address.toLowerCase()) throw new Error('address mismatch');
  if (Math.abs(Date.now() - Date.parse(m[3])) > 10 * 60_000) throw new Error('login message expired');
  const signer = await recoverMessageAddress({ message, signature });
  if (signer.toLowerCase() !== address.toLowerCase()) throw new Error('bad signature');
  if (!(await store.useNonce(m[2]))) throw new Error('nonce already used or expired');
  const body = b64(JSON.stringify({ a: getAddress(address), exp: Date.now() + 12 * 3600_000 }));
  return `${body}.${mac(secret, body)}`;
}

export function authenticate(secret: string, token: string | undefined): Address {
  const [body, sig] = (token ?? '').split('.');
  if (!body || !sig) throw new Error('not signed in');
  const ok = mac(secret, body), a = Buffer.from(ok), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('not signed in');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (p.exp < Date.now()) throw new Error('session expired');
  return p.a as Address;
}
