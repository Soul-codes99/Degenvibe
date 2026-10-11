import { importSPKI, jwtVerify } from 'jose';

/** Verifies a Privy access token (ES256 JWT) against the app's public verification key.
 *  Returns the Privy user id (the token's `sub`). Needs only the PUBLIC verification key, never the app secret. */
export function makePrivyVerifier(appId: string, pem: string) {
  const key = importSPKI(pem.replace(/\\n/g, '\n'), 'ES256');
  return async (token: string): Promise<string> => {
    const { payload } = await jwtVerify(token, await key, { issuer: 'privy.io', audience: appId });
    if (!payload.sub) throw new Error('bad token');
    return payload.sub;
  };
}
export type PrivyVerifier = (token: string) => Promise<string>;
