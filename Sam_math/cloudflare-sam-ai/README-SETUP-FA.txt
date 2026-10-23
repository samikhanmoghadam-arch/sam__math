# SAM MATH + SAM AI

## What is included
- The previous SAM MATH offline pages and features are preserved.
- `sam-ai.html`, `sam-ai.css`, `sam-ai.js` add the fifth SAM AI section.
- `cloudflare-sam-ai/` contains the online Worker backend. The browser code does not contain a provider secret key.

## Important
- SAM MATH's normal calculator/tools/geometry remain local files and can work offline.
- SAM AI needs an internet connection and a deployed Cloudflare Worker.
- Free access is limited by the current Cloudflare account/model quotas and can change. No unlimited-free AI is guaranteed.
- The sample Worker is a starter. Before sharing it widely, add Cloudflare rate limiting/abuse protection. CORS is not authentication.
- Do not send passwords or private information to the AI.

## Setup once on your own computer
1. Create/sign in to a Cloudflare account and check that Workers AI is enabled and its current free allowance/model availability is suitable.
2. Install Node.js LTS from https://nodejs.org/.
3. Open a terminal in this `cloudflare-sam-ai` folder and run:

   ```powershell
   npm create cloudflare@latest -- sam-ai-temp
   ```

   You do not need to run the command above if you already have Wrangler installed; the simpler route is:

   ```powershell
   npx wrangler login
   npx wrangler deploy
   ```

   If Wrangler asks to install the package, accept. The provided `wrangler.jsonc` and `src/index.js` are the project files to deploy. If Wrangler reports a configuration/model error, follow the current Cloudflare Workers AI model catalog and account prompts; model availability can change.

4. When deploy succeeds, copy the actual `https://...workers.dev` URL printed in the terminal.
5. Open the website's `sam-ai.js` and replace `PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE` with that URL, keeping the quotes.
6. Copy the whole `SAM-MATH` folder to your USB drive. Test the local `index.html` offline; then connect to the internet and test SAM AI.

## Suggested simpler deploy command
From this folder, after installing Node.js and logging in:

```powershell
npx wrangler deploy
```

Do not put any secret API keys into `sam-ai.js` or any file on the USB drive.
