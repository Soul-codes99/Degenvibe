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

## The game page
Menu, character select, shop, live game and a no-wallet DEMO all live in `public/index.html`. The art is embedded in the file, so it works anywhere on its own. Original high-res art is in `art-source/`.
`public/index.html` is the whole game UI. Vercel serves it at `/` and it talks to `/api` on the same site, so no extra setup.
Opened from anywhere else, add `?api=https://your-server` to the address.

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
    GET  /api/unlocks            wager volume and which blobs are unlocked
    GET  /api/history            settled runs with seeds so players can verify
    POST /api/cron/settle        retries stuck settlements (Authorization: Bearer CRON_SECRET)
Send the token as `Authorization: Bearer <token>`. Characters: 0 Nova, 1 Tank, 2 Zen (free); 3 Soul, 4 Ember, 5 Frost. Each unlocks by HOLDING $SOUL (Soul 6.43M, Ember and Frost 2.15M, checked when a run starts) OR by WAGERING ETH (Soul 0.5, Ember and Frost 0.1; total stake of confirmed runs, permanent).

## Known limits
- No rate limiting yet. Add one before a public launch.
- Vercel Hobby cron runs once a day at most. Stuck settlements are also retried whenever the player reloads their run.
- A server outage mid-run: the player can reclaim the stake from the vault after 2 hours (winnings are not recoverable).
- The server is trusted for outcomes. Players can audit afterwards: keccak256(serverSeed) equals the on-chain commit.
- No global leaderboard yet.

## Stake caps that grow with the house pool
The max stake of each mode is a share of the FREE pool (pool minus what open runs have reserved): Safe 1%, Trencher 2%,
Degen 4%. At a 0.05 ETH pool that is the launch limit (0.0005 / 0.001 / 0.002 ETH). At 0.5 ETH it is 0.005 / 0.01 / 0.02.
The server applies this live and `/api/config` shows the current value. The vault's own `maxStake` is the hard ceiling,
so raise it once (owner wallet), then the caps follow the pool by themselves:

    VAULT=0xc70b231A670A4DDa8b761Bcd9f4431278458F8aa
    RPC=https://rpc.testnet.chain.robinhood.com
    cast send $VAULT "setMode(uint8,(uint128,uint128,uint128,uint16,uint32,bool))" 0 "(100000000000000,10000000000000000,100000000000000,350,1570,true)" --account deployer --rpc-url $RPC
    cast send $VAULT "setMode(uint8,(uint128,uint128,uint128,uint16,uint32,bool))" 1 "(200000000000000,50000000000000000,200000000000000,350,6590,true)" --account deployer --rpc-url $RPC
    cast send $VAULT "setMode(uint8,(uint128,uint128,uint128,uint16,uint32,bool))" 2 "(500000000000000,200000000000000000,500000000000000,280,38400,true)" --account deployer --rpc-url $RPC

Ceilings: Safe 0.01, Trencher 0.05, Degen 0.2 ETH. Top up the pool any time: `cast send $VAULT "fundPool()" --value 0.1ether --account deployer --rpc-url $RPC`.
