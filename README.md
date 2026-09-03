# Tyro Doors & Drawers

Node + Express API and static frontend for the cutlister app.

## API behavior

- `GET /api/health` returns service health.
- `GET /api/config` returns resolved plan (`free` or `pro`) and `upgradeUrl` from `WIX_UPGRADE_URL`.
- `GET /api/auth/session` returns current auth state.
- `POST /api/auth/sso` accepts trusted identity payload, creates/updates the user, and sets signed `cabinet_session` cookie.
- `POST /api/auth/logout` clears the session cookie.
- `POST /api/billing/webhook` updates user billing state server-side.
- `GET/POST/PUT/DELETE /api/projects` are auth-required and user-scoped.
- `GET/POST/PUT/DELETE /api/presets` are auth-required and user-scoped.
- Existing catalog/settings endpoints remain available.

## Identity exchange flow

Your website backend should send JSON identity payloads to `POST /api/auth/sso` with:

- `x-identity-timestamp`: current epoch milliseconds
- `x-identity-signature`: HMAC SHA256 over `timestamp + "." + rawJsonBody`

Use `IDENTITY_SHARED_SECRET` for signing.

## Billing webhook flow

Send billing updates to `POST /api/billing/webhook` and authenticate with either:

- `x-billing-secret` header with your webhook secret value
- `Authorization` bearer token with your webhook secret value

Payload should include `email` and/or external identifiers plus `plan` and `subscriptionStatus`.

`pro` access is granted only when:

- `plan = "pro"`
- `subscriptionStatus` is one of `active`, `trialing`, `paid`

## Environment variables

Required for production:

- `DATABASE_URL` (Render Postgres connection string)
- `SESSION_SECRET`
- `IDENTITY_SHARED_SECRET`
- `BILLING_WEBHOOK_SECRET`
- `WIX_UPGRADE_URL`

Optional:

- `CORS_ORIGINS`
- `ALLOW_GITHUB_PAGES` (default `true`)
- `SERVE_STATIC` (default `true`)
- `USER_STORE_FILE` and `LEGACY_STORE_FILE` for local/test file overrides

## Local development

```bash
npm install
npm start
```

Run tests:

```bash
npm test
```

Without `DATABASE_URL`, user/account/project/preset data falls back to local JSON file storage.

## Render deployment notes

`render.yaml` now includes:

- Node web service with health check `/api/health`
- Render Postgres database resource
- `DATABASE_URL` wiring from that database
- secret env var placeholders for identity/billing/session config
