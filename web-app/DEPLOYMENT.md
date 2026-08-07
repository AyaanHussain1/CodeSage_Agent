# Deploying This So You Can Share a Link

Two separate things get deployed:

1. **Backend** (`backend/server.py`) → needs a real server (Railway), since it
   runs Python, calls OpenAI, and needs to write files temporarily during upload/indexing.
2. **Web app** (`web-app/`) → just static HTML/CSS/JS, can go on any free static host
   (Vercel, Netlify, or GitHub Pages).

## Step 1 — Deploy the backend to Railway

1. Push your project to GitHub (you're already doing this)
2. Go to https://railway.app → sign in with GitHub
3. **New Project → Deploy from GitHub repo** → select your repo
4. Railway needs to know to run the `backend` folder specifically. In your
   repo's root, add a file called `railway.json`:
   ```json
   {
     "build": { "builder": "NIXPACKS" },
     "deploy": { "startCommand": "cd backend && python server.py" }
   }
   ```
5. In Railway's dashboard, go to **Variables** and add your OpenAI key:
   ```
   OPENAI_API_KEY=your-key-here
   ```
   (Don't commit your real `.env` file to GitHub — add `.env` to `.gitignore` if it's not already there.)
6. Railway will give you a public URL like `https://your-app.up.railway.app`
   — this is your live backend.

## Step 2 — Point the web app at your deployed backend

In `web-app/app.js`, change the very first line:
```javascript
// Before (local testing):
const API_URL = "http://localhost:8000";

// After (pointing at your deployed backend):
const API_URL = "https://your-app.up.railway.app";
```

## Step 3 — Deploy the web app itself (pick one, all free)

**Option A — Vercel (easiest if you're already using GitHub)**
1. Go to https://vercel.com → sign in with GitHub
2. **New Project** → select your repo
3. Set the **root directory** to `web-app` (important — otherwise it'll try to deploy the whole repo)
4. Deploy. You'll get a link like `https://your-project.vercel.app`

**Option B — GitHub Pages**
1. In your repo settings → **Pages**
2. Set source to the `web-app` folder on your main branch
3. GitHub gives you a link like `https://yourusername.github.io/your-repo/`

Either way, **this is the link you show recruiters.**

## Why two deployments instead of one

Vercel/Netlify/GitHub Pages only serve static files — they can't run a
persistent Python process, write files to disk, or call OpenAI on your
behalf securely (an API key in frontend code would be visible to anyone who
opens dev tools). Railway runs your actual backend continuously; the static
host just serves the HTML/CSS/JS that talks to it.

## Note on file uploads at scale

Each visitor's uploaded project gets saved to `uploaded_projects/<uuid>/` on
the server. Right now nothing deletes these automatically — fine for a demo
or portfolio piece, but if this ever gets real traffic, you'd want a cleanup
job (e.g. delete folders older than a few hours) so the server's disk doesn't
fill up over time.
