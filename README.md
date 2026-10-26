# Tyro Doors & Drawers

Node + Express API and static frontend for the cutlister app.

## API behavior

- `GET /api/health` returns service health.
- `GET /api/config` returns resolved plan (`free` or `pro`) and `upgradeUrl` from `WIX_UPGRADE_URL`.
- `GET /api/auth/session` returns current auth state.
- `GET /api/auth/wix/login` starts Wix OAuth sign-in.
- `GET /api/auth/wix/callback` completes Wix OAuth sign-in, creates/updates the user, and sets signed `cabinet_session` cookie.
- `POST /api/auth/sso` remains available for trusted server-to-server identity exchange.
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

When Wix OAuth client credentials are configured, the OAuth callback uses the member access token to verify the current member with:

- `GET https://www.wixapis.com/members/v1/members/my?fieldSet=FULL`
- `GET https://www.wixapis.com/pricing-plans/v2/member/orders`

When Wix OAuth client credentials are configured, save/customize entitlement checks also support server-side verification using:

- `GET https://www.wixapis.com/pricing-plans/v2/orders`
- `buyerIds=<externalMemberId>`
- `orderStatuses=ACTIVE`

Access is allowed only when an order is:

- status `ACTIVE`
- matching configured paid plan IDs (`WIX_PAID_PLAN_IDS`)

No-access statuses include: `CANCELED`, `ENDED`, `PAUSED`, `REFUNDED`, `FAILED`.

User data is retained and not auto-deleted before 13 months of inactivity (`DATA_RETENTION_MONTHS`, default `13`).

## Environment variables

Required for production:

- `DATABASE_URL` (Render Postgres connection string)
- `SESSION_SECRET` (strongly recommended; when omitted the server derives a stable fallback from another configured backend secret, but an explicit dedicated value is still preferred)
- `IDENTITY_SHARED_SECRET`
- `BILLING_WEBHOOK_SECRET`
- `WIX_CLIENT_ID`
- `WIX_CLIENT_SECRET`
- `DOORS_DRAWERS_BRIDGE_SECRET` (shared only between Render and Wix backend code; never expose it to page code)
- `WIX_OAUTH_REDIRECT_URI`
- `WIX_SITE_ID`
- `WIX_UPGRADE_URL`

Optional:

- `WIX_PAID_PLAN_IDS` (recommended, comma-separated Wix plan IDs)
- `WIX_OAUTH_SCOPE`
- `WIX_POST_LOGIN_REDIRECT_URL` (optional; where to send the browser after Wix sign-in, e.g. your app's page URL, so the welcome banner shows the member's name)
- `DATA_RETENTION_MONTHS` (default `13`)
- `CORS_ORIGINS`
- `SESSION_COOKIE_SAME_SITE` (`None`, `Lax`, or `Strict`; defaults to `None` in production and `Lax` otherwise)
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

## Wix member sessions and private saved projects

The embedded app needs a backend-authenticated member session to save projects. Do not send a member ID, `paid` flag, or shared secret from browser code as proof of identity or entitlement. Instead, have a Wix backend web method obtain the signed-in member and call Render with a secret stored in Wix Secrets Manager. Render creates the member account, verifies paid access using Wix and `WIX_PAID_PLAN_IDS`, and returns a short-lived app token. Project APIs use that token and continue to scope records to the authenticated user.

1. In Render, set `DOORS_DRAWERS_BRIDGE_SECRET` to a newly generated, long random value.
2. In Wix Secrets Manager, create a secret also named `DOORS_DRAWERS_BRIDGE_SECRET` with the same value. Never place this value in Wix page code.
3. Add this as `backend/wixBridge.web.js` in Wix. Replace the URL only if your Render service URL differs.

```js
import { currentMember } from "wix-members-backend";
import { Permissions, webMethod } from "wix-web-module";
import { getSecret } from "wix-secrets-backend";
import { fetch } from "wix-fetch";

const RENDER_URL = "https://tyro-doors-drawers.onrender.com";

export const getCutlisterSession = webMethod(Permissions.SiteMember, async () => {
  const member = await currentMember.getMember({ fieldsets: ["FULL"] });
  if (!member) {
    throw new Error("Sign in to your Wix member account.");
  }

  const profile = member.profile || {};
  const contact = member.contactDetails || {};
  const memberId = member._id || member.id || "";
  const email = member.loginEmail || member.email || profile.email || "";
  const name = profile.nickname || profile.displayName
    || [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  if (!memberId || !email) {
    throw new Error("Wix did not return the member ID and email.");
  }

  const bridgeSecret = await getSecret("DOORS_DRAWERS_BRIDGE_SECRET");
  const response = await fetch(`${RENDER_URL}/api/auth/wix/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wix-bridge-secret": bridgeSecret
    },
    body: JSON.stringify({ externalMemberId: memberId, email, name })
  });
  if (!response.ok) {
    throw new Error("Could not establish the app session.");
  }
  return response.json();
});
```

4. Replace the Wix page's current member-message code with this. The HTML component ID must be `html1`.

```js
import { getCutlisterSession } from "backend/wixBridge.web";

let sending = false;

$w.onReady(() => {
  const sendSession = async () => {
    if (sending) return;
    sending = true;
    try {
      const session = await getCutlisterSession();
      $w("#html1").postMessage({
        type: "wix-member",
        name: session.user.name || "",
        paid: session.paid === true,
        userId: session.user.id,
        sessionToken: session.sessionToken
      });
    } catch (_error) {
      $w("#html1").postMessage({ type: "wix-member-logout" });
    } finally {
      sending = false;
    }
  };

  $w("#html1").onMessage((event) => {
    if (event.data && event.data.type === "cutlister-ready") sendSession();
  });
  sendSession();
  setInterval(sendSession, 15 * 60 * 1000);
});
```

Publish the Wix site after installing both pieces. The Wix backend refreshes the app token periodically; the token is sent only to the iframe and held in its memory. The app server independently checks the member's current order before every save/customization write; the message's `paid` value only controls display. Keep the Wix origin in Render's `CORS_ORIGINS` and in `wixParentOrigins` in `config.js`.
