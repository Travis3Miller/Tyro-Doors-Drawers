# Tyro Doors & Drawers

Node + Express API and static frontend for the cutlister app.

## API behavior

- `GET /api/health` returns service health.
- `GET /api/config` returns resolved plan (`free` or `pro`) and `upgradeUrl` from `WIX_UPGRADE_URL`.
- `GET /api/auth/session` returns current auth state.
- `POST /api/auth/sso` accepts trusted identity payload, creates/updates the user, and sets signed `cabinet_session` cookie.
- `POST /api/auth/logout` clears the session cookie.
- `POST /api/billing/webhook` updates user billing state server-side.
- `POST /api/can-save` checks if the signed-in member currently has paid save/customize access.
- `GET/POST/PUT/DELETE /api/projects` are auth-required and user-scoped.
- `GET/POST/PUT/DELETE /api/presets` are auth-required and user-scoped.
- Save/customize writes (projects, presets, settings, catalog edits) require active paid entitlement.

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
- `subscriptionStatus` is one of `active`, `trialing`, `paid`, `pending`

## Wix paywall checks

When `WIX_API_TOKEN` is configured, the API verifies Wix Pricing Plan orders using:

- `GET https://www.wixapis.com/pricing-plans/v2/orders`
- `buyerIds=<externalMemberId>`
- `orderStatuses=ACTIVE`
- `orderStatuses=PENDING`

Access is allowed only when an order is:

- status `ACTIVE` or `PENDING`
- payment status `PAID`
- matching configured paid plan IDs (`WIX_PAID_PLAN_IDS`) or paid plan names (`WIX_PAID_PLAN_NAMES`)

No-access statuses include: `CANCELED`, `ENDED`, `PAUSED`, `REFUNDED`, `FAILED`.

User data is retained and not auto-deleted before 13 months of inactivity (`DATA_RETENTION_MONTHS`, default `13`).

## Environment variables

Required for production:

- `DATABASE_URL` (Render Postgres connection string)
- `SESSION_SECRET` (strongly recommended; when omitted the server derives a stable fallback from another configured backend secret, but an explicit dedicated value is still preferred)
- `IDENTITY_SHARED_SECRET`
- `BILLING_WEBHOOK_SECRET`
- `WIX_API_TOKEN`
- `WIX_UPGRADE_URL`

Optional:

- `WIX_PAID_PLAN_IDS` (recommended, comma-separated Wix plan IDs)
- `WIX_PAID_PLAN_NAMES` (comma-separated plan names, used when IDs are not set)
- `DATA_RETENTION_MONTHS` (default `13`)
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
