const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  SESSION_SECRET: process.env.SESSION_SECRET,
  IDENTITY_SHARED_SECRET: process.env.IDENTITY_SHARED_SECRET,
  BILLING_WEBHOOK_SECRET: process.env.BILLING_WEBHOOK_SECRET,
  WIX_CLIENT_ID: process.env.WIX_CLIENT_ID,
  WIX_CLIENT_SECRET: process.env.WIX_CLIENT_SECRET,
  WIX_OAUTH_REDIRECT_URI: process.env.WIX_OAUTH_REDIRECT_URI,
  WIX_PAID_PLAN_IDS: process.env.WIX_PAID_PLAN_IDS,
  USER_STORE_FILE: process.env.USER_STORE_FILE,
  LEGACY_STORE_FILE: process.env.LEGACY_STORE_FILE,
  WIX_UPGRADE_URL: process.env.WIX_UPGRADE_URL,
  RENDER_SERVICE_ID: process.env.RENDER_SERVICE_ID
};

function signIdentity(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64url");
}

function jsonRequest(baseUrl, route, options = {}) {
  return fetch(`${baseUrl}${route}`, options);
}

function loadServerModule() {
  const modulePath = require.resolve("../server");
  delete require.cache[modulePath];
  return require("../server");
}

test("health/config, auth session, project isolation, and billing entitlement", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tyro-dd-"));
  const userStoreFile = path.join(tempDir, "user-store.json");
  const legacyStoreFile = path.join(tempDir, "legacy-store.json");

  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.IDENTITY_SHARED_SECRET = "identity-secret";
  process.env.BILLING_WEBHOOK_SECRET = "billing-secret";
  process.env.WIX_CLIENT_ID = "wix-client-id";
  process.env.WIX_CLIENT_SECRET = "wix-client-secret";
  process.env.WIX_PAID_PLAN_IDS = "plan-doors";
  process.env.USER_STORE_FILE = userStoreFile;
  process.env.LEGACY_STORE_FILE = legacyStoreFile;
  process.env.WIX_UPGRADE_URL = "https://example.com/upgrade";

  let wixMemberResponse = {
    member: {
      id: "member-oauth",
      loginEmail: "oauth-user@example.com",
      profile: {
        nickname: "OAuth User"
      }
    }
  };

  const wixFetch = async (url) => {
    if (url === "https://www.wixapis.com/oauth2/token") {
      return new Response(JSON.stringify({
        access_token: "site-access-token",
        expires_in: 300
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://www.wix.com/oauth/access") {
      return new Response(JSON.stringify({
        access_token: "member-access-token",
        expires_in: 300
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://www.wixapis.com/members/v1/members/me") {
      return new Response(JSON.stringify(wixMemberResponse), { status: 200, headers: { "content-type": "application/json" } });
    }
    const parsed = new URL(url);
    const buyerId = parsed.searchParams.get("buyerIds");
    if (buyerId === "member-a") {
      return new Response(JSON.stringify({
        orders: [
          {
            id: "order-a",
            status: "ACTIVE",
            paymentStatus: "PAID",
            planId: "plan-doors",
            planName: "Doors and Drawers Cutlister"
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      orders: [
        {
          id: "order-b",
          status: "CANCELED",
          paymentStatus: "PAID",
          planId: "plan-doors",
          planName: "Doors and Drawers Cutlister"
        }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const { startServer } = loadServerModule();
  const { server } = await startServer({ port: 0, wixFetch });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
    if (originalEnv.IDENTITY_SHARED_SECRET === undefined) delete process.env.IDENTITY_SHARED_SECRET; else process.env.IDENTITY_SHARED_SECRET = originalEnv.IDENTITY_SHARED_SECRET;
    if (originalEnv.BILLING_WEBHOOK_SECRET === undefined) delete process.env.BILLING_WEBHOOK_SECRET; else process.env.BILLING_WEBHOOK_SECRET = originalEnv.BILLING_WEBHOOK_SECRET;
    if (originalEnv.WIX_CLIENT_ID === undefined) delete process.env.WIX_CLIENT_ID; else process.env.WIX_CLIENT_ID = originalEnv.WIX_CLIENT_ID;
    if (originalEnv.WIX_CLIENT_SECRET === undefined) delete process.env.WIX_CLIENT_SECRET; else process.env.WIX_CLIENT_SECRET = originalEnv.WIX_CLIENT_SECRET;
    if (originalEnv.WIX_OAUTH_REDIRECT_URI === undefined) delete process.env.WIX_OAUTH_REDIRECT_URI; else process.env.WIX_OAUTH_REDIRECT_URI = originalEnv.WIX_OAUTH_REDIRECT_URI;
    if (originalEnv.WIX_PAID_PLAN_IDS === undefined) delete process.env.WIX_PAID_PLAN_IDS; else process.env.WIX_PAID_PLAN_IDS = originalEnv.WIX_PAID_PLAN_IDS;
    if (originalEnv.USER_STORE_FILE === undefined) delete process.env.USER_STORE_FILE; else process.env.USER_STORE_FILE = originalEnv.USER_STORE_FILE;
    if (originalEnv.LEGACY_STORE_FILE === undefined) delete process.env.LEGACY_STORE_FILE; else process.env.LEGACY_STORE_FILE = originalEnv.LEGACY_STORE_FILE;
    if (originalEnv.WIX_UPGRADE_URL === undefined) delete process.env.WIX_UPGRADE_URL; else process.env.WIX_UPGRADE_URL = originalEnv.WIX_UPGRADE_URL;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const healthRes = await jsonRequest(baseUrl, "/api/health");
  assert.equal(healthRes.status, 200);
  const healthBody = await healthRes.json();
  assert.equal(healthBody.ok, true);

  const assetRes = await jsonRequest(baseUrl, "/api/assets/ButtJoint%20Drawer.jpg");
  assert.equal(assetRes.status, 200);

  const missingAssetRes = await jsonRequest(baseUrl, "/api/assets/not-a-real-file.png");
  assert.equal(missingAssetRes.status, 404);

  const configRes = await jsonRequest(baseUrl, "/api/config");
  assert.equal(configRes.status, 200);
  const configBody = await configRes.json();
  assert.equal(configBody.plan, "free");
  assert.equal(configBody.upgradeUrl, "https://example.com/upgrade");

  process.env.WIX_OAUTH_REDIRECT_URI = `${baseUrl}/api/auth/wix/callback`;
  const wixLoginRes = await jsonRequest(baseUrl, "/api/auth/wix/login", {
    redirect: "manual"
  });
  assert.equal(wixLoginRes.status, 302);
  const oauthLocation = wixLoginRes.headers.get("location");
  assert.ok(oauthLocation && oauthLocation.startsWith("https://www.wix.com/oauth/authorize?"));
  const oauthState = new URL(oauthLocation).searchParams.get("state");
  assert.ok(oauthState);

  const wixCallbackRes = await jsonRequest(baseUrl, `/api/auth/wix/callback?code=test-code&state=${encodeURIComponent(oauthState)}`);
  assert.equal(wixCallbackRes.status, 200);
  const oauthSessionCookie = wixCallbackRes.headers.get("set-cookie");
  assert.ok(oauthSessionCookie && oauthSessionCookie.includes("cabinet_session="));
  const wixCallbackBody = await wixCallbackRes.json();
  assert.equal(wixCallbackBody.authenticated, true);
  assert.equal(wixCallbackBody.user.externalMemberId, "member-oauth");
  assert.equal(wixCallbackBody.user.email, "oauth-user@example.com");
  const wixCallbackReplayRes = await jsonRequest(baseUrl, `/api/auth/wix/callback?code=test-code&state=${encodeURIComponent(oauthState)}`);
  assert.equal(wixCallbackReplayRes.status, 400);

  const wixCallbackInvalidStateRes = await jsonRequest(baseUrl, "/api/auth/wix/callback?code=test-code&state=invalid");
  assert.equal(wixCallbackInvalidStateRes.status, 400);

  const wixCallbackErrorRes = await jsonRequest(baseUrl, "/api/auth/wix/callback?error=access_denied");
  assert.equal(wixCallbackErrorRes.status, 401);

  delete process.env.WIX_OAUTH_REDIRECT_URI;
  const wixLoginMissingRedirectRes = await jsonRequest(baseUrl, "/api/auth/wix/login", {
    redirect: "manual"
  });
  assert.equal(wixLoginMissingRedirectRes.status, 503);
  process.env.WIX_OAUTH_REDIRECT_URI = `${baseUrl}/api/auth/wix/callback`;

  wixMemberResponse = { member: { id: "", loginEmail: "" } };
  const wixLoginInvalidMemberRes = await jsonRequest(baseUrl, "/api/auth/wix/login", {
    redirect: "manual"
  });
  assert.equal(wixLoginInvalidMemberRes.status, 302);
  const invalidMemberState = new URL(wixLoginInvalidMemberRes.headers.get("location")).searchParams.get("state");
  const wixCallbackInvalidMemberRes = await jsonRequest(baseUrl, `/api/auth/wix/callback?code=test-code&state=${encodeURIComponent(invalidMemberState)}`);
  assert.equal(wixCallbackInvalidMemberRes.status, 400);
  wixMemberResponse = {
    member: {
      id: "member-oauth",
      loginEmail: "oauth-user@example.com",
      profile: { nickname: "OAuth User" }
    }
  };

  const userAIdentity = JSON.stringify({
    email: "user-a@example.com",
    name: "User A",
    externalMemberId: "member-a",
    plan: "free",
    subscriptionStatus: "inactive"
  });
  const tsA = String(Date.now());
  const sigA = signIdentity(process.env.IDENTITY_SHARED_SECRET, tsA, userAIdentity);
  const ssoARes = await jsonRequest(baseUrl, "/api/auth/sso", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-identity-timestamp": tsA,
      "x-identity-signature": sigA
    },
    body: userAIdentity
  });

  assert.equal(ssoARes.status, 200);
  const sessionCookieA = ssoARes.headers.get("set-cookie");
  assert.ok(sessionCookieA && sessionCookieA.includes("cabinet_session="));

  const sessionRes = await jsonRequest(baseUrl, "/api/auth/session", {
    headers: { cookie: sessionCookieA }
  });
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  assert.equal(sessionBody.authenticated, true);
  assert.equal(sessionBody.user.email, "user-a@example.com");

  const userAIdentityRebind = JSON.stringify({
    email: "user-a@example.com",
    name: "User A Renamed",
    externalMemberId: "member-a-other"
  });
  const tsARebind = String(Date.now());
  const sigARebind = signIdentity(process.env.IDENTITY_SHARED_SECRET, tsARebind, userAIdentityRebind);
  const ssoARebindRes = await jsonRequest(baseUrl, "/api/auth/sso", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-identity-timestamp": tsARebind,
      "x-identity-signature": sigARebind
    },
    body: userAIdentityRebind
  });
  assert.equal(ssoARebindRes.status, 200);
  const rebindCookieA = ssoARebindRes.headers.get("set-cookie");
  const rebindSessionRes = await jsonRequest(baseUrl, "/api/auth/session", {
    headers: { cookie: rebindCookieA }
  });
  const rebindSessionBody = await rebindSessionRes.json();
  assert.equal(rebindSessionRes.status, 200);
  assert.equal(rebindSessionBody.user.externalMemberId, "member-a");

  const createProjectRes = await jsonRequest(baseUrl, "/api/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookieA
    },
    body: JSON.stringify({
      name: "A Project",
      payload: { doors: [{ width: 12 }] }
    })
  });
  assert.equal(createProjectRes.status, 201);

  const canSaveARes = await jsonRequest(baseUrl, "/api/can-save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookieA
    },
    body: JSON.stringify({})
  });
  assert.equal(canSaveARes.status, 200);
  const canSaveA = await canSaveARes.json();
  assert.equal(canSaveA.allowed, true);
  assert.equal(canSaveA.retentionMonths, 13);

  const userBIdentity = JSON.stringify({
    email: "user-b@example.com",
    name: "User B",
    externalMemberId: "member-b",
    plan: "free",
    subscriptionStatus: "inactive"
  });
  const tsB = String(Date.now());
  const sigB = signIdentity(process.env.IDENTITY_SHARED_SECRET, tsB, userBIdentity);
  const ssoBRes = await jsonRequest(baseUrl, "/api/auth/sso", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-identity-timestamp": tsB,
      "x-identity-signature": sigB
    },
    body: userBIdentity
  });
  assert.equal(ssoBRes.status, 200);
  const sessionCookieB = ssoBRes.headers.get("set-cookie");

  const projectsARes = await jsonRequest(baseUrl, "/api/projects", {
    headers: { cookie: sessionCookieA }
  });
  const projectsA = await projectsARes.json();
  assert.equal(projectsARes.status, 200);
  assert.equal(projectsA.length, 1);
  assert.equal(projectsA[0].name, "A Project");

  const projectsBRes = await jsonRequest(baseUrl, "/api/projects", {
    headers: { cookie: sessionCookieB }
  });
  const projectsB = await projectsBRes.json();
  assert.equal(projectsBRes.status, 200);
  assert.equal(projectsB.length, 0);

  const canSaveBRes = await jsonRequest(baseUrl, "/api/can-save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookieB
    },
    body: JSON.stringify({})
  });
  assert.equal(canSaveBRes.status, 200);
  const canSaveB = await canSaveBRes.json();
  assert.equal(canSaveB.allowed, false);

  const createProjectBRes = await jsonRequest(baseUrl, "/api/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookieB
    },
    body: JSON.stringify({
      name: "B Project",
      payload: { doors: [{ width: 10 }] }
    })
  });
  assert.equal(createProjectBRes.status, 403);

  const billingRes = await jsonRequest(baseUrl, "/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-billing-secret": process.env.BILLING_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      externalMemberId: "member-a",
      plan: "pro",
      subscriptionStatus: "active"
    })
  });
  assert.equal(billingRes.status, 200);

  const billingWrongMemberRes = await jsonRequest(baseUrl, "/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-billing-secret": process.env.BILLING_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      externalMemberId: "member-a-other",
      plan: "pro",
      subscriptionStatus: "active"
    })
  });
  assert.equal(billingWrongMemberRes.status, 404);

  const userALoginAfterBilling = JSON.stringify({
    email: "user-a@example.com",
    name: "User A",
    externalMemberId: "member-a",
    plan: "free",
    subscriptionStatus: "inactive"
  });
  const tsAfterBilling = String(Date.now());
  const sigAfterBilling = signIdentity(process.env.IDENTITY_SHARED_SECRET, tsAfterBilling, userALoginAfterBilling);
  const ssoAfterBillingRes = await jsonRequest(baseUrl, "/api/auth/sso", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-identity-timestamp": tsAfterBilling,
      "x-identity-signature": sigAfterBilling
    },
    body: userALoginAfterBilling
  });
  assert.equal(ssoAfterBillingRes.status, 200);
  const sessionAfterBillingCookie = ssoAfterBillingRes.headers.get("set-cookie");

  const configProRes = await jsonRequest(baseUrl, "/api/config", {
    headers: { cookie: sessionAfterBillingCookie || sessionCookieA }
  });
  assert.equal(configProRes.status, 200);
  const configPro = await configProRes.json();
  assert.equal(configPro.plan, "pro");

  process.env.WIX_PAID_PLAN_IDS = "";
  const canSaveLegacyProRes = await jsonRequest(baseUrl, "/api/can-save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionAfterBillingCookie || sessionCookieA
    },
    body: JSON.stringify({})
  });
  assert.equal(canSaveLegacyProRes.status, 200);
  const canSaveLegacyPro = await canSaveLegacyProRes.json();
  assert.equal(canSaveLegacyPro.allowed, true);

  process.env.WIX_CLIENT_ID = "";
  process.env.WIX_CLIENT_SECRET = "";
  const canSaveLegacyNoOauthRes = await jsonRequest(baseUrl, "/api/can-save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionAfterBillingCookie || sessionCookieA
    },
    body: JSON.stringify({})
  });
  assert.equal(canSaveLegacyNoOauthRes.status, 200);
  const canSaveLegacyNoOauth = await canSaveLegacyNoOauthRes.json();
  assert.equal(canSaveLegacyNoOauth.allowed, true);
});

test("server boots without SESSION_SECRET and keeps sessions valid across restarts when another secret is configured", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tyro-dd-"));
  const userStoreFile = path.join(tempDir, "user-store.json");
  const legacyStoreFile = path.join(tempDir, "legacy-store.json");

  process.env.NODE_ENV = "test";
  delete process.env.SESSION_SECRET;
  process.env.IDENTITY_SHARED_SECRET = "identity-secret";
  process.env.BILLING_WEBHOOK_SECRET = "billing-secret";
  process.env.WIX_CLIENT_ID = "";
  process.env.WIX_CLIENT_SECRET = "";
  process.env.WIX_PAID_PLAN_IDS = "plan-doors";
  process.env.USER_STORE_FILE = userStoreFile;
  process.env.LEGACY_STORE_FILE = legacyStoreFile;
  process.env.WIX_UPGRADE_URL = "https://example.com/upgrade";
  process.env.RENDER_SERVICE_ID = "render-service-a";

  let { startServer } = loadServerModule();
  const { server } = await startServer({ port: 0 });
  let restartedServer = null;

  t.after(async () => {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    if (restartedServer && restartedServer.listening) {
      await new Promise((resolve, reject) => {
        restartedServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
    if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
    if (originalEnv.IDENTITY_SHARED_SECRET === undefined) delete process.env.IDENTITY_SHARED_SECRET; else process.env.IDENTITY_SHARED_SECRET = originalEnv.IDENTITY_SHARED_SECRET;
    if (originalEnv.BILLING_WEBHOOK_SECRET === undefined) delete process.env.BILLING_WEBHOOK_SECRET; else process.env.BILLING_WEBHOOK_SECRET = originalEnv.BILLING_WEBHOOK_SECRET;
    if (originalEnv.WIX_CLIENT_ID === undefined) delete process.env.WIX_CLIENT_ID; else process.env.WIX_CLIENT_ID = originalEnv.WIX_CLIENT_ID;
    if (originalEnv.WIX_CLIENT_SECRET === undefined) delete process.env.WIX_CLIENT_SECRET; else process.env.WIX_CLIENT_SECRET = originalEnv.WIX_CLIENT_SECRET;
    if (originalEnv.WIX_OAUTH_REDIRECT_URI === undefined) delete process.env.WIX_OAUTH_REDIRECT_URI; else process.env.WIX_OAUTH_REDIRECT_URI = originalEnv.WIX_OAUTH_REDIRECT_URI;
    if (originalEnv.WIX_PAID_PLAN_IDS === undefined) delete process.env.WIX_PAID_PLAN_IDS; else process.env.WIX_PAID_PLAN_IDS = originalEnv.WIX_PAID_PLAN_IDS;
    if (originalEnv.USER_STORE_FILE === undefined) delete process.env.USER_STORE_FILE; else process.env.USER_STORE_FILE = originalEnv.USER_STORE_FILE;
    if (originalEnv.LEGACY_STORE_FILE === undefined) delete process.env.LEGACY_STORE_FILE; else process.env.LEGACY_STORE_FILE = originalEnv.LEGACY_STORE_FILE;
    if (originalEnv.WIX_UPGRADE_URL === undefined) delete process.env.WIX_UPGRADE_URL; else process.env.WIX_UPGRADE_URL = originalEnv.WIX_UPGRADE_URL;
    if (originalEnv.RENDER_SERVICE_ID === undefined) delete process.env.RENDER_SERVICE_ID; else process.env.RENDER_SERVICE_ID = originalEnv.RENDER_SERVICE_ID;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const userIdentity = JSON.stringify({
    email: "fallback@example.com",
    name: "Fallback User",
    externalMemberId: "member-fallback"
  });
  const timestamp = String(Date.now());
  const signature = signIdentity(process.env.IDENTITY_SHARED_SECRET, timestamp, userIdentity);

  const ssoRes = await jsonRequest(baseUrl, "/api/auth/sso", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-identity-timestamp": timestamp,
      "x-identity-signature": signature
    },
    body: userIdentity
  });

  assert.equal(ssoRes.status, 200);
  const sessionCookie = ssoRes.headers.get("set-cookie");
  assert.ok(sessionCookie && sessionCookie.includes("cabinet_session="));

  const sessionRes = await jsonRequest(baseUrl, "/api/auth/session", {
    headers: { cookie: sessionCookie }
  });
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  assert.equal(sessionBody.authenticated, true);
  assert.equal(sessionBody.user.email, "fallback@example.com");

  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  ({ startServer } = loadServerModule());
  ({ server: restartedServer } = await startServer({ port: 0 }));

  const restartedAddr = restartedServer.address();
  const restartedBaseUrl = `http://127.0.0.1:${restartedAddr.port}`;
  const restartedSessionRes = await jsonRequest(restartedBaseUrl, "/api/auth/session", {
    headers: { cookie: sessionCookie }
  });
  assert.equal(restartedSessionRes.status, 200);
  const restartedSessionBody = await restartedSessionRes.json();
  assert.equal(restartedSessionBody.authenticated, true);
  assert.equal(restartedSessionBody.user.email, "fallback@example.com");

  await new Promise((resolve, reject) => {
    restartedServer.close((err) => (err ? reject(err) : resolve()));
  });

  process.env.RENDER_SERVICE_ID = "render-service-b";
  ({ startServer } = loadServerModule());
  ({ server: restartedServer } = await startServer({ port: 0 }));

  const isolatedSessionRes = await jsonRequest(`http://127.0.0.1:${restartedServer.address().port}`, "/api/auth/session", {
    headers: { cookie: sessionCookie }
  });
  assert.equal(isolatedSessionRes.status, 200);
  const isolatedSessionBody = await isolatedSessionRes.json();
  assert.equal(isolatedSessionBody.authenticated, false);
});
