# Updating the live site with a new zip

1. Download degen-vibe-server.zip from the chat (it goes to your Windows Downloads folder).
2. In Ubuntu, copy it home and unzip into a temporary folder:
       ls /mnt/c/Users/                       # find your Windows user name
       cp /mnt/c/Users/YOURNAME/Downloads/degen-vibe-server.zip ~/
       cd ~ && rm -rf dv-new && mkdir dv-new && unzip -q degen-vibe-server.zip -d dv-new     # sudo apt install unzip if needed
3. Copy the new files over the old ones (same names are overwritten, your .env, .git and node_modules are not touched):
       cp -r ~/dv-new/server/. ~/degen-vibe-server/server/
4. Remove files that no longer exist in the new version:
       cd ~/degen-vibe-server/server && rm -rf public package-lock.json
5. Set the new variables in Vercel (Settings, Environment Variables):
       PRIVY_VERIFICATION_KEY   public key from the Privy dashboard (Settings, Basics). Paste it whole, with the BEGIN and END lines
       DRIP_PRIVATE_KEY         key of a NEW wallet that holds the starter test ETH (never your owner or operator key)
   Optional: DRIP_WEI (default 1000000000000000 = 0.001 ETH) and DRIP_DAILY_MAX (default 50).
6. Publish:
       git status                                            # if it says "not a git repository", try the parent folder
       git add -A && git commit -m "Privy sign-in" && git push     # Vercel redeploys by itself
   Deployed with the Vercel CLI instead? Run:  npx vercel --prod
7. Wait for "Ready" in Vercel, Deployments. The build now takes about a minute because it bundles the sign-in.
8. Open https://YOUR-SITE/api/config. It should show "drip" with "enabled": true. Then hard refresh the page (Ctrl+Shift+R).
Rollback: Vercel, Deployments, pick the last good one, three dots, Promote to Production.
