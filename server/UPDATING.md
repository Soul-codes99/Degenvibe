# Updating the live site with a new zip

1. Download degen-vibe-server.zip from the chat (it goes to your Windows Downloads folder).
2. In Ubuntu, copy it home and unzip into a temporary folder:
       ls /mnt/c/Users/                       # find your Windows user name
       cp /mnt/c/Users/YOURNAME/Downloads/degen-vibe-server.zip ~/
       cd ~ && rm -rf dv-new && mkdir dv-new && unzip -q degen-vibe-server.zip -d dv-new     # sudo apt install unzip if needed
3. Copy the new files over the old ones (same names are overwritten, your .env, .git and node_modules are not touched):
       cp -r ~/dv-new/server/. ~/degen-vibe-server/server/
       rm -rf ~/degen-vibe-server/server/public/assets      # old art folder, no longer used
4. See what changed, then publish:
       cd ~/degen-vibe-server/server && git status          # if it says "not a git repository", try the parent folder
       git add -A && git commit -m "update" && git push     # Vercel redeploys by itself
   Deployed with the Vercel CLI instead? Run:  npx vercel --prod
5. In Vercel open Deployments and wait for "Ready". Remove the SHOP variable if it is still there, then Redeploy.
6. Check https://YOUR-SITE/api/config. It must show "unlock" and a "maxStake" per mode. Then hard refresh the page (Ctrl+Shift+R).
Rollback: Vercel, Deployments, pick the last good one, three dots, Promote to Production.
