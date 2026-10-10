#!/usr/bin/env bash
# Local end-to-end test: anvil + the real contracts + this server.  Needs Foundry, and ../contracts, ../script, ../test from the contracts project.
set -euo pipefail
FV=${FV:-/home/claude/fv}; export PATH="$FV:$PATH"; export FOUNDRY_SOLC=${FOUNDRY_SOLC:-$FV/solc}
D0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
K1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
K3=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
K4=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
K5=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
RPC=http://127.0.0.1:8545
anvil --silent --port 8545 & ANVIL=$!; trap "kill $ANVIL" EXIT; sleep 2
cd "$FV"
SOUL=$(forge create test/Shop.t.sol:MockSoul --rpc-url $RPC --private-key $D0 --broadcast --constructor-args 18 2>&1 | awk '/Deployed to:/{print $3}')
OUT=$(OPERATOR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 TREASURY=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC SOUL_TOKEN=$SOUL POOL_WEI=50000000000000000 \
  forge script script/Deploy.s.sol --rpc-url $RPC --private-key $D0 --broadcast 2>&1)
VAULT=$(echo "$OUT" | awk '/vault /{print $2}' | tail -1); SHOP=$(echo "$OUT" | awk '/shop /{print $2}' | tail -1)
echo "soul=$SOUL vault=$VAULT shop=$SHOP"
cd - >/dev/null
DATABASE_URL=${DATABASE_URL:-} RPC_URL=$RPC CHAIN_ID=31337 VAULT=$VAULT SHOP=$SHOP SOUL=$SOUL OPERATOR_KEY=$K1 DEPLOYER_KEY=$D0 PLAYER1_KEY=$K3 PLAYER2_KEY=$K4 PLAYER3_KEY=$K5 \
  npx tsx --test test/e2e.test.ts
