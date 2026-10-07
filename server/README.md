# DEGEN VIBE game server (testnet)

Holds the secret tile seeds, signs vault tickets, resolves every move, and settles runs on-chain with the operator key.
The browser never sees a tile result before it is revealed, and never sees the seed until the run is settled.

## What was tested
- 25 engine tests: ladder, checkpoints, Soul revive, Frost and Ember rules, caps, illegal moves, and Monte Carlo checks
  that every mode and character keeps its house edge (`npm test`).
- 8 end-to-end tests on a local chain with the real vault and shop, run against both the memory store and a real
  Postgres (`./e2e.sh`): wallet login, tamper and replay attempts, shop unlocks, abilities, pool cap, a 5-way
  parallel cash-out race (exactly one settlement), and settlement outage recovery.
- NOT tested: a live run on Robinhood testnet, and load.

## Run locally
    npm install
    cp .env.example .env   # fill in, then export the variables
    npm run dev            # http://localhost:8787

## Deploy on Vercel with a free Postgres (Neon or Supabase)
1. Push this folder to a GitHub repo and import it in Vercel.
2. Create a Postgres database and copy its connection string.
3. In Vercel, add the variables from `.env.example` as Environment Variables. Generate SESSION_SECRET and CRON_SECRET
   with `openssl rand -hex 32`. OPERATOR_PRIVATE_KEY is the key for 0x7434...de0c. Set ALLOWED_ORIGIN to your game site.
4. Fund the operator wallet with a little testnet ETH for gas.
5. Deploy. Tables are created automatically on first use.

## API (JSON)
    GET  /api/config             modes, stake limits, ladders per character
    GET  /api/nonce              then sign the login message and POST /api/login {address,message,signature} -> {token}
    POST /api/ticket             {mode,character,stake} -> ticket + signature for startRun
    POST /api/confirm            {txHash} after the player's startRun transaction is mined
    POST /api/step               {col, activate?}   free, no signing
    POST /api/cashout            free, no signing
    GET  /api/run                current run (resume after refresh)
    GET  /api/history            settled runs with seeds so players can verify
    POST /api/cron/settle        retries stuck settlements (Authorization: Bearer CRON_SECRET)
Send the token as `Authorization: Bearer <token>`. Characters: 0 Nova, 1 Tank, 2 Zen (free); 3 Soul, 4 Ember, 5 Frost (shop).

## Known limits
- No rate limiting yet. Add one before a public launch.
- Vercel Hobby cron runs once a day at most. Stuck settlements are also retried whenever the player reloads their run.
- A server outage mid-run: the player can reclaim the stake from the vault after 2 hours (winnings are not recoverable).
- The server is trusted for outcomes. Players can audit afterwards: keccak256(serverSeed) equals the on-chain commit.
- No global leaderboard yet.
