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
  USER_STORE_FILE: process.env.USER_STORE_FILE,
  LEGACY_STORE_FILE: process.env.LEGACY_STORE_FILE,
  WIX_UPGRADE_URL: process.env.WIX_UPGRADE_URL
};

function signIdentity(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64url");
}

function jsonRequest(baseUrl, route, options = {}) {
  return fetch(`${baseUrl}${route}`, options);
}

test("health/config, auth session, project isolation, and billing entitlement", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tyro-dd-"));
  const userStoreFile = path.join(tempDir, "user-store.json");
  const legacyStoreFile = path.join(tempDir, "legacy-store.json");

  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.IDENTITY_SHARED_SECRET = "identity-secret";
  process.env.BILLING_WEBHOOK_SECRET = "billing-secret";
  process.env.USER_STORE_FILE = userStoreFile;
  process.env.LEGACY_STORE_FILE = legacyStoreFile;
  process.env.WIX_UPGRADE_URL = "https://example.com/upgrade";

  const { startServer } = require("../server");
  const { server } = await startServer({ port: 0 });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
    if (originalEnv.IDENTITY_SHARED_SECRET === undefined) delete process.env.IDENTITY_SHARED_SECRET; else process.env.IDENTITY_SHARED_SECRET = originalEnv.IDENTITY_SHARED_SECRET;
    if (originalEnv.BILLING_WEBHOOK_SECRET === undefined) delete process.env.BILLING_WEBHOOK_SECRET; else process.env.BILLING_WEBHOOK_SECRET = originalEnv.BILLING_WEBHOOK_SECRET;
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

  const configRes = await jsonRequest(baseUrl, "/api/config");
  assert.equal(configRes.status, 200);
  const configBody = await configRes.json();
  assert.equal(configBody.plan, "free");
  assert.equal(configBody.upgradeUrl, "https://example.com/upgrade");

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

  const billingRes = await jsonRequest(baseUrl, "/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-billing-secret": process.env.BILLING_WEBHOOK_SECRET
    },
    body: JSON.stringify({
      email: "user-a@example.com",
      plan: "pro",
      subscriptionStatus: "active"
    })
  });
  assert.equal(billingRes.status, 200);

  const configProRes = await jsonRequest(baseUrl, "/api/config", {
    headers: { cookie: sessionCookieA }
  });
  assert.equal(configProRes.status, 200);
  const configPro = await configProRes.json();
  assert.equal(configPro.plan, "pro");
});
