# GitHub + Render Deployment Setup

This project is now configured to support:
- Static frontend hosting (GitHub Pages)
- Node API hosting (Render)
- Per-browser user scoping for saved projects/templates through `x-user-id`

## 1. Deploy backend to Render

1. Push this repo to GitHub.
2. In Render, create a new **Web Service** from the repo.
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
4. Set environment variables in Render:
   - `SERVE_STATIC=false`
   - `CORS_ORIGINS=https://<your-github-username>.github.io`
   - `ALLOW_GITHUB_PAGES=true`
5. Deploy and copy your Render URL, for example:
   - `https://doors-drawers-cutlister-api.onrender.com`

## 2. Point frontend to Render API

Edit `config.js` in this repo:

```js
window.CUTLISTER_CONFIG = {
  apiBaseUrl: "https://doors-drawers-cutlister-api.onrender.com"
};
```

Commit and push.

## 3. Deploy frontend to GitHub Pages

1. In GitHub repo settings, enable **Pages**.
2. Choose branch and root folder where `index.html` exists.
3. Wait for Pages to publish.

Your frontend will now call Render API using the URL from `config.js`.

## 4. Local development

- Full stack from Node (same origin):
  - Keep `SERVE_STATIC=true`
  - Run `npm install`
  - Run `npm start`
  - Open `http://localhost:3000`
- Frontend static + API local:
  - Keep `config.js` `apiBaseUrl` empty for same origin or set to local API URL.

## Important notes

1. Current per-user separation is browser-based (local user id sent in request header).
2. It is not secure authentication.
3. For paid plans and true accounts, add real auth (JWT/session with user table) and a persistent database.
4. `data/store.json` file storage is fine for testing, but production should move to a database for reliability and scaling.
