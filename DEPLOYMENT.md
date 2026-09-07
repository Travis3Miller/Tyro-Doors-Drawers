# GitHub + Render Deployment Setup

This project is configured for:
- Static frontend hosting (GitHub Pages)
- Node API hosting (Render)
- Server-side authenticated multi-user project/preset storage
- Server-side billing entitlement checks

## 1. Deploy backend to Render

1. Push this repo to GitHub.
2. In Render, create a Blueprint deploy from `render.yaml`.
3. Confirm the web service and Postgres database resources are created.
4. In the web service environment, set:
   - `IDENTITY_SHARED_SECRET`
   - `BILLING_WEBHOOK_SECRET`
   - `WIX_CLIENT_ID`
   - `WIX_CLIENT_SECRET`
   - `WIX_OAUTH_REDIRECT_URI`
   - `WIX_PAID_PLAN_IDS` (recommended)
   - `WIX_UPGRADE_URL`
   - optional `WIX_OAUTH_SCOPE`
   - optional `DATA_RETENTION_MONTHS` (default 13)
5. `SESSION_SECRET` is generated automatically when you deploy from `render.yaml`; if it is missing, the server derives a stable fallback from another configured backend secret so the app can still boot, but you should still set `SESSION_SECRET` explicitly for a dedicated session-signing key.
6. `DATABASE_URL` is automatically wired from Render Postgres.

## 2. Configure trusted identity exchange

Your website backend must call `POST /api/auth/sso` with:
- JSON identity payload
- `x-identity-timestamp`
- `x-identity-signature` (HMAC SHA256 of `timestamp + "." + rawJsonBody` with `IDENTITY_SHARED_SECRET`)

The API sets an httpOnly signed `cabinet_session` cookie.

## 3. Configure billing webhook

Send billing updates to `POST /api/billing/webhook` and authenticate with:
- `x-billing-secret`, or
- bearer token in `Authorization`

Use `BILLING_WEBHOOK_SECRET` as the shared secret.

## 4. Configure Wix OAuth and paywall entitlement

The backend enforces paid-only save/customize server-side.

- Start OAuth login at `GET /api/auth/wix/login`.
- Handle Wix callback at `GET /api/auth/wix/callback` (sets signed app session cookie).

- Endpoint: `POST /api/can-save`
- Requires signed-in session.
- Checks Wix Pricing Plan orders for the authenticated member (`externalMemberId`) with:
  - status `ACTIVE`
  - matching plan IDs (`WIX_PAID_PLAN_IDS`)

Write operations (projects, presets, settings, and catalog customization routes) are blocked unless entitlement passes.

Data is retained and not auto-deleted before 13 months of inactivity.

## 5. Frontend API base URL

Set `config.js`:

```js
window.CUTLISTER_CONFIG = {
  apiBaseUrl: "https://doors-drawers-cutlister-api.onrender.com"
};
```

## 6. Local development

- Run `npm install`
- Run `npm start`
- Run `npm test`

When `DATABASE_URL` is missing, user/account/project/preset data uses local JSON storage.
