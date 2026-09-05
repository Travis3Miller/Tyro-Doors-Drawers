const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createUserStore } = require("./user-store");

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.LEGACY_STORE_FILE || path.join(__dirname, "data", "store.json");
const PUBLIC_USER_ID = "public";
const SERVE_STATIC = process.env.SERVE_STATIC !== "false";

const SESSION_COOKIE_NAME = "cabinet_session";
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const PRO_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid", "pending"]);
const DENIED_ORDER_STATUSES = new Set(["CANCELED", "ENDED", "PAUSED", "REFUNDED", "FAILED"]);
const RETENTION_MONTHS = Number(process.env.DATA_RETENTION_MONTHS || 13);
let legacyStoreQueue = Promise.resolve();
const STATIC_FILES = new Set([
  "index.html",
  "script.js",
  "styles.css",
  "config.js",
  "Bottom Groove Location and Depth(Square).png",
  "Bottom Groove Location and Depth.png",
  "ButtJoint Drawer.jpg",
  "ButtJoint Side Long.png",
  "ButtJoint Side Short.png",
  "DT Side and Front Through.png",
  "Dovetail Drawer Box.png",
  "Dovetail Side Set Back.png",
  "LJ Long Front Dado Depth(SQUARE).png",
  "LJ Long Front Dado Depth.png",
  "LJ Long Side Dado Depth.png",
  "LockJoint Drawer.jpg",
  "Plant-On Bottom.png",
  "Rear Drawer Bottom Dim.png"
]);

const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];
const allowedOrigins = configuredOrigins.length ? configuredOrigins : defaultOrigins;
const allowAllOrigins = allowedOrigins.includes("*");
const allowGithubPages = process.env.ALLOW_GITHUB_PAGES !== "false";

function isGithubPagesOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".github.io");
  } catch (_err) {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }
  if (allowAllOrigins || allowedOrigins.includes(origin)) {
    return true;
  }
  return allowGithubPages && isGithubPagesOrigin(origin);
}

function readCookies(req) {
  const raw = req.headers.cookie || "";
  const parsed = {};
  for (const chunk of raw.split(";")) {
    const [key, ...rest] = chunk.trim().split("=");
    if (!key) {
      continue;
    }
    parsed[key] = decodeURIComponent(rest.join("="));
  }
  return parsed;
}

function signHmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  return parts.join("; ");
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET || "";
  if (secret) {
    return { secret, mode: "configured" };
  }
  const persistentFallbacks = [
    ["IDENTITY_SHARED_SECRET", process.env.IDENTITY_SHARED_SECRET || ""],
    ["BILLING_WEBHOOK_SECRET", process.env.BILLING_WEBHOOK_SECRET || ""],
    ["WIX_CLIENT_SECRET", process.env.WIX_CLIENT_SECRET || ""],
    ["DATABASE_URL", process.env.DATABASE_URL || ""]
  ];
  const persistentFallback = persistentFallbacks.find(([, value]) => value);
  if (persistentFallback) {
    const [sourceName, sourceValue] = persistentFallback;
    const deploymentSalt = [
      process.env.RENDER_SERVICE_ID || "",
      process.env.RENDER_EXTERNAL_URL || "",
      process.env.RENDER_SERVICE_NAME || "",
      process.env.DATABASE_URL || "",
      process.env.CORS_ORIGINS || "",
      __dirname
    ].join("|");
    return {
      secret: signHmac(`derived-session-secret:${deploymentSalt}`, sourceValue),
      mode: `derived:${sourceName}`
    };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required when no persistent fallback secret is available.");
  }
  return {
    secret: crypto.randomBytes(32).toString("hex"),
    mode: "ephemeral"
  };
}

function createSessionToken(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signHmac(encoded, secret);
  return `${encoded}.${signature}`;
}

function verifySessionToken(token, secret) {
  if (!token || typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encoded, signature] = parts;
  const expected = signHmac(encoded, secret);
  if (!safeCompare(signature, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || !payload.userId || typeof payload.exp !== "number") {
      return null;
    }
    if (Date.now() >= payload.exp) {
      return null;
    }
    return payload;
  } catch (_err) {
    return null;
  }
}

function encodeState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signHmac(encoded, secret);
  return `${encoded}.${signature}`;
}

function decodeState(token, secret) {
  if (!token || typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encoded, signature] = parts;
  const expected = signHmac(encoded, secret);
  if (!safeCompare(signature, expected)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (_err) {
    return null;
  }
}

function oauthConfigured() {
  return Boolean((process.env.WIX_CLIENT_ID || "").trim() && (process.env.WIX_CLIENT_SECRET || "").trim());
}

function wixRedirectUri(req) {
  const configured = (process.env.WIX_OAUTH_REDIRECT_URI || "").trim();
  if (configured) {
    return configured;
  }
  const forwardedProto = (req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host") || "";
  if (!host) {
    return "";
  }
  return `${protocol}://${host}/api/auth/wix/callback`;
}

async function exchangeWixAuthCode(code, redirectUri, fetchImpl = fetch) {
  const clientId = (process.env.WIX_CLIENT_ID || "").trim();
  const clientSecret = (process.env.WIX_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret || !code || !redirectUri) {
    return null;
  }

  const response = await fetchImpl("https://www.wix.com/oauth/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });

  if (!response.ok) {
    throw new Error(`Wix OAuth exchange failed with ${response.status}.`);
  }
  const body = await response.json();
  return body && typeof body.access_token === "string" ? body.access_token : null;
}

async function getWixClientToken(fetchImpl = fetch, cache = {}) {
  const clientId = (process.env.WIX_CLIENT_ID || "").trim();
  const clientSecret = (process.env.WIX_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    return null;
  }

  if (cache.accessToken && Number.isFinite(cache.expiresAt) && cache.expiresAt - 30_000 > Date.now()) {
    return cache.accessToken;
  }

  const response = await fetchImpl("https://www.wixapis.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!response.ok) {
    throw new Error(`Wix OAuth client token request failed with ${response.status}.`);
  }

  const body = await response.json();
  if (!body || typeof body.access_token !== "string" || !body.access_token.trim()) {
    throw new Error("Wix OAuth client token response did not include access_token.");
  }

  const expiresIn = Number(body.expires_in);
  cache.accessToken = body.access_token.trim();
  cache.expiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 1000 * 60 * 4);
  return cache.accessToken;
}

async function getWixMemberFromToken(accessToken, fetchImpl = fetch) {
  if (!accessToken) {
    return null;
  }
  const response = await fetchImpl("https://www.wixapis.com/members/v1/members/me", {
    method: "GET",
    headers: {
      Authorization: "Bearer " + accessToken
    }
  });
  if (!response.ok) {
    throw new Error(`Wix member profile request failed with ${response.status}.`);
  }
  const body = await response.json();
  if (body && body.member && typeof body.member === "object") {
    return body.member;
  }
  return body && typeof body === "object" ? body : null;
}

function identityFromWixMember(member) {
  const source = member && typeof member === "object" ? member : {};
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const email = String(source.loginEmail || source.email || profile.email || "").trim().toLowerCase();
  const externalMemberId = String(source.id || source.memberId || "").trim();
  const name = String(profile.nickname || profile.displayName || source.name || "").trim();
  return { email, name, externalMemberId };
}

function identityTrusted(req) {
  const timestamp = req.get("x-identity-timestamp") || "";
  const signature = req.get("x-identity-signature") || "";
  const sharedSecret = process.env.IDENTITY_SHARED_SECRET || "";
  const enforce = process.env.NODE_ENV === "production" || Boolean(sharedSecret);

  if (!enforce) {
    return true;
  }
  if (!sharedSecret || !timestamp || !signature) {
    return false;
  }

  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  const now = Date.now();
  if (Math.abs(now - parsed) > 1000 * 60 * 5) {
    return false;
  }

  const rawBody = typeof req.rawBody === "string" ? req.rawBody : "";
  const expected = signHmac(`${timestamp}.${rawBody}`, sharedSecret);
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  return safeCompare(provided, expected);
}

function billingTrusted(req) {
  const sharedSecret = process.env.BILLING_WEBHOOK_SECRET || "";
  const enforce = process.env.NODE_ENV === "production" || Boolean(sharedSecret);
  if (!enforce) {
    return true;
  }

  const headerSecret = req.get("x-billing-secret") || "";
  const authHeader = req.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const provided = headerSecret || bearer;

  if (!sharedSecret || !provided) {
    return false;
  }
  return safeCompare(provided, sharedSecret);
}

function parseCsvEnv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function paidPlanIds() {
  return new Set(parseCsvEnv(process.env.WIX_PAID_PLAN_IDS));
}

function normalizeOrderStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function mapWixStatusToSubscriptionStatus(status) {
  const normalized = normalizeOrderStatus(status);
  if (normalized === "ACTIVE") {
    return "active";
  }
  if (normalized === "PENDING") {
    return "pending";
  }
  return "inactive";
}

function hasPaidWixAccess(orders = []) {
  const ids = paidPlanIds();
  if (!ids.size) {
    return false;
  }

  return orders.some((order) => {
    const status = normalizeOrderStatus(order.status);
    if (status !== "ACTIVE") {
      return false;
    }
    return ids.has(String(order.planId || "").trim());
  });
}

function canDenyFromWixOrders(orders = []) {
  return orders.some((order) => DENIED_ORDER_STATUSES.has(normalizeOrderStatus(order.status)));
}

async function getWixOrdersForMember(memberId, fetchImpl = fetch, tokenCache = {}) {
  if (!memberId) {
    return null;
  }
  const wixAccessToken = await getWixClientToken(fetchImpl, tokenCache);
  if (!wixAccessToken) {
    return null;
  }

  const url = new URL("https://www.wixapis.com/pricing-plans/v2/orders");
  url.searchParams.append("buyerIds", memberId);
  url.searchParams.append("orderStatuses", "ACTIVE");

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: "Bearer " + wixAccessToken,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Wix orders request failed with ${response.status}.`);
  }

  const body = await response.json();
  if (Array.isArray(body.orders)) {
    return body.orders;
  }
  if (body && body.orders && Array.isArray(body.orders.results)) {
    return body.orders.results;
  }
  if (body && body.data && Array.isArray(body.data.orders)) {
    return body.data.orders;
  }
  return [];
}

async function evaluateSaveAccessForUser(user, userStore, fetchImpl = fetch, tokenCache = {}) {
  if (!user) {
    return { allowed: false, reason: "unauthenticated" };
  }

  if (!paidPlanIds().size) {
    return { allowed: false, reason: "no-paid-plan-ids" };
  }

  const memberId = user.externalMemberId || "";
  const wixOrders = await getWixOrdersForMember(memberId, fetchImpl, tokenCache);
  if (!wixOrders) {
    return { allowed: false, reason: "no-wix-member-or-oauth-client" };
  }

  const allowed = hasPaidWixAccess(wixOrders);
  if (allowed) {
    const matchingOrder = wixOrders.find((order) => {
      const status = normalizeOrderStatus(order.status);
      return status === "ACTIVE";
    }) || null;

    const subscriptionStatus = mapWixStatusToSubscriptionStatus(matchingOrder ? matchingOrder.status : "ACTIVE");
    const updatedUser = await userStore.updateUserBilling({
      userId: user.id,
      email: user.email,
      externalMemberId: user.externalMemberId,
      externalCustomerId: user.externalCustomerId,
      plan: "pro",
      subscriptionStatus
    });
    return {
      allowed: true,
      reason: "wix-order",
      user: updatedUser || user
    };
  }

  if (canDenyFromWixOrders(wixOrders)) {
    await userStore.updateUserBilling({
      userId: user.id,
      email: user.email,
      externalMemberId: user.externalMemberId,
      externalCustomerId: user.externalCustomerId,
      plan: "free",
      subscriptionStatus: "inactive"
    });
  }

  return { allowed: false, reason: "no-active-paid-order" };
}

function resolvePlanForUser(user) {
  const plan = user && typeof user.plan === "string" ? user.plan.toLowerCase() : "free";
  const subscriptionStatus = user && typeof user.subscriptionStatus === "string"
    ? user.subscriptionStatus.toLowerCase()
    : "inactive";

  if (plan === "pro" && PRO_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
    return "pro";
  }
  return "free";
}

function userSummary(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    externalCustomerId: user.externalCustomerId,
    externalMemberId: user.externalMemberId
  };
}

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      const fallback = normalizeStore({});
      await writeStore(fallback);
      return fallback;
    }
    throw err;
  }
}

async function writeStore(store) {
  const normalized = normalizeStore(store);
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(normalized, null, 2), "utf8");
}

function mutateLegacyStore(mutator) {
  const run = legacyStoreQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  legacyStoreQueue = run.catch(() => {});
  return run;
}

function defaultCatalog() {
  return {
    doorStyles: [
      {
        id: "default-shaker",
        name: "Shaker - Cope & Stick",
        jointType: "copeStick",
        stileWidth: 2.25,
        railWidth: 2.25,
        grooveDepth: 0.5,
        copeDepth: 0.5,
        stickDepth: 0.5,
        panelClearance: 0.0625,
        matchRailsToStiles: false,
        customTopRail: false,
        topRailWidth: 2.25,
        oversizeEnabled: false,
        oversizeAmount: 0.125
      }
    ],
    overlayTemplates: [
      {
        id: "overlay-face-frame",
        name: "Face Frame 1/2 all around",
        left: 0.5,
        right: 0.5,
        top: 0.5,
        bottom: 0.5,
        gap: 0.125
      },
      {
        id: "overlay-full-3-4",
        name: "Full Overlay 3/4 all around",
        left: 0.75,
        right: 0.75,
        top: 0.75,
        bottom: 0.75,
        gap: 0.125
      },
      {
        id: "overlay-frameless",
        name: "Frameless / Euro",
        left: 0.6875,
        right: 0.6875,
        top: 0.25,
        bottom: 0.75,
        gap: 0.125
      }
    ],
    drawerSlides: [
      {
        id: "slide-blum-undermount",
        name: "Blum Undermount (5/16 sides)",
        sideClearance: 0.3125,
        depthClearance: 0.5,
        topClearance: 0.5,
        bottomClearance: 0.5
      },
      {
        id: "slide-side-mount",
        name: "Side Mount (1/2 sides)",
        sideClearance: 0.5,
        depthClearance: 0.25,
        topClearance: 0.5,
        bottomClearance: 0.5
      }
    ],
    drawerConstructions: [
      {
        id: "construct-butt",
        name: "Butt Joint",
        constructionType: "butt",
        sideThickness: 0.5,
        frontBackThickness: 0.5,
        bottomThickness: 0.25,
        bottomInset: 0.25,
        bottomAdjustWidth: 0.0625,
        bottomAdjustLength: 0.0625,
        buttSideRun: "length",
        buttBottomPlacement: "grooved",
        buttGrooveDepth: 0.25,
        buttGrooveHeight: 0.25,
        buttGrooveSides: true,
        buttGrooveFront: true,
        buttGrooveBack: false,
        lockSideRun: "length",
        lockDadoDepth: 0.25,
        bottomThicknessIncluded: false
      },
      {
        id: "construct-dovetail",
        name: "Dovetail",
        constructionType: "dovetail",
        sideThickness: 0.5,
        frontBackThickness: 0.75,
        bottomThickness: 0.25,
        bottomInset: 0.25,
        bottomAdjustWidth: 0.0625,
        bottomAdjustLength: 0.0625,
        dovetailMode: "through",
        dovetailFrontSetbackEnabled: false,
        dovetailBackSetbackEnabled: false,
        dovetailFrontSetback: 0,
        dovetailBackSetback: 0,
        lockSideRun: "length",
        lockDadoDepth: 0.25,
        bottomThicknessIncluded: false
      },
      {
        id: "construct-lock",
        name: "Lock Joint",
        constructionType: "lock",
        sideThickness: 0.5,
        frontBackThickness: 0.5,
        bottomThickness: 0.25,
        bottomInset: 0.25,
        bottomAdjustWidth: 0.0625,
        bottomAdjustLength: 0.0625,
        lockSideRun: "length",
        lockDadoDepth: 0.25,
        bottomThicknessIncluded: false
      },
      {
        id: "construct-custom",
        name: "Custom",
        constructionType: "custom",
        sideThickness: 0.5,
        frontBackThickness: 0.5,
        bottomThickness: 0.25,
        bottomInset: 0.25,
        bottomAdjustWidth: 0.0625,
        bottomAdjustLength: 0.0625,
        customFrontRipSign: "sub",
        customFrontRipOffset: 0,
        customBackRipSign: "sub",
        customBackRipOffset: 0,
        customSideRipSign: "sub",
        customSideRipOffset: 0,
        customFrontLenSign: "sub",
        customFrontLenOffset: 0,
        customBackLenSign: "sub",
        customBackLenOffset: 0,
        customSideLenSign: "sub",
        customSideLenOffset: 0,
        customBottomWidthBasis: "width",
        customBottomWidthSign: "sub",
        customBottomWidthOffset: 0,
        customBottomLengthBasis: "depth",
        customBottomLengthSign: "sub",
        customBottomLengthOffset: 0,
        lockSideRun: "length",
        lockDadoDepth: 0.25,
        bottomThicknessIncluded: false
      }
    ]
  };
}

function defaultSettings() {
  return {
    unitSystem: "in",
    precision: "1/16"
  };
}

function defaultUserStore() {
  const defaults = defaultCatalog();
  return {
    doorStyles: defaults.doorStyles,
    overlayTemplates: defaults.overlayTemplates,
    drawerSlides: defaults.drawerSlides,
    drawerConstructions: defaults.drawerConstructions,
    settings: defaultSettings()
  };
}

function normalizeUserStore(store) {
  const source = store && typeof store === "object" ? store : {};
  const defaults = defaultCatalog();
  return {
    doorStyles: Array.isArray(source.doorStyles) && source.doorStyles.length ? source.doorStyles : defaults.doorStyles,
    overlayTemplates: Array.isArray(source.overlayTemplates) && source.overlayTemplates.length ? source.overlayTemplates : defaults.overlayTemplates,
    drawerSlides: Array.isArray(source.drawerSlides) && source.drawerSlides.length ? source.drawerSlides : defaults.drawerSlides,
    drawerConstructions: Array.isArray(source.drawerConstructions) && source.drawerConstructions.length
      ? source.drawerConstructions
      : defaults.drawerConstructions,
    settings: { ...defaultSettings(), ...(source.settings || {}) }
  };
}

function normalizeStore(store) {
  const source = store && typeof store === "object" ? store : {};
  const users = {};
  const rawUsers = source.users;

  if (rawUsers && typeof rawUsers === "object" && !Array.isArray(rawUsers)) {
    for (const [userId, userStore] of Object.entries(rawUsers)) {
      users[userId] = normalizeUserStore(userStore || {});
    }
  }

  if (!Object.keys(users).length) {
    users[PUBLIC_USER_ID] = defaultUserStore();
  }

  return { users };
}

function catalogScopeUserId(req) {
  if (req.currentUser && req.currentUser.id) {
    return `auth:${req.currentUser.id}`;
  }
  return PUBLIC_USER_ID;
}

function getUserStore(store, userId) {
  if (!store.users[userId]) {
    store.users[userId] = defaultUserStore();
  }
  return store.users[userId];
}

function attachRawBody(req, _res, buffer) {
  req.rawBody = buffer.toString("utf8");
}

function createApp(options = {}) {
  const app = express();
  const { secret: sessionSecret, mode: sessionSecretMode } = getSessionSecret();
  if (sessionSecretMode === "ephemeral") {
    console.warn("SESSION_SECRET is not set. Using an ephemeral in-memory secret; sessions will be reset on restart.");
  } else if (sessionSecretMode.startsWith("derived:")) {
    console.warn(`SESSION_SECRET is not set. Deriving the session signing secret from ${sessionSecretMode.slice(8)}; set SESSION_SECRET for an explicit persistent secret.`);
  }
  const wixFetch = options.wixFetch || fetch;
  const wixClientTokenCache = { accessToken: "", expiresAt: 0 };
  const requestRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false
  });
  const authRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false
  });
  const userStore = options.userStore || createUserStore({});
  const userStoreReady = Promise.resolve(userStore.init());

  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    }
  }));
  app.use(express.json({ verify: attachRawBody }));

  app.use(requestRateLimiter, async (req, _res, next) => {
    try {
      await userStoreReady;
      req.currentUser = null;
      const cookies = readCookies(req);
      const token = cookies[SESSION_COOKIE_NAME];
      const session = verifySessionToken(token, sessionSecret);
      if (session && session.userId) {
        req.currentUser = await userStore.getUserById(session.userId);
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  if (SERVE_STATIC) {
    app.get("/", requestRateLimiter, (_req, res) => {
      res.sendFile(path.join(__dirname, "index.html"));
    });
    app.get("/:asset", requestRateLimiter, (req, res, next) => {
      const asset = req.params.asset;
      if (!STATIC_FILES.has(asset)) {
        next();
        return;
      }
      res.sendFile(path.join(__dirname, asset));
    });
  }

  function requireAuth(req, res, next) {
    if (!req.currentUser) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    next();
  }

  async function requireSubscriber(req, res, next) {
    try {
      const check = await evaluateSaveAccessForUser(req.currentUser, userStore, wixFetch, wixClientTokenCache);
      if (!check.allowed) {
        res.status(403).json({
          error: "Active paid subscription required.",
          reason: check.reason
        });
        return;
      }
      if (check.user) {
        req.currentUser = check.user;
      }
      next();
    } catch (_err) {
      res.status(503).json({ error: "Could not verify subscription access." });
    }
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get("/api/assets/:name", requestRateLimiter, (req, res) => {
    const name = String(req.params.name || "");
    if (!STATIC_FILES.has(name)) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.sendFile(path.join(__dirname, name), (err) => {
      if (!err || res.headersSent) {
        return;
      }
      if (err.code === "ENOENT") {
        res.status(404).json({ error: "Asset not found." });
        return;
      }
      res.status(500).json({ error: "Could not load asset." });
    });
  });

  app.get("/api/config", (req, res) => {
    const plan = resolvePlanForUser(req.currentUser);
    res.json({
      plan,
      upgradeUrl: process.env.WIX_UPGRADE_URL || ""
    });
  });

  app.get("/api/auth/session", (req, res) => {
    const user = req.currentUser;
    res.json({
      authenticated: Boolean(user),
      user: userSummary(user),
      plan: resolvePlanForUser(user)
    });
  });

  app.get("/api/auth/wix/login", authRateLimiter, (req, res) => {
    if (!oauthConfigured()) {
      res.status(503).json({ error: "Wix OAuth is not configured." });
      return;
    }
    const redirectUri = wixRedirectUri(req);
    if (!redirectUri) {
      res.status(500).json({ error: "Could not determine Wix OAuth redirect URL." });
      return;
    }

    const state = encodeState({
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now()
    }, sessionSecret);
    const oauthUrl = new URL("https://www.wix.com/oauth/authorize");
    oauthUrl.searchParams.set("client_id", (process.env.WIX_CLIENT_ID || "").trim());
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("state", state);

    const scope = (process.env.WIX_OAUTH_SCOPE || "").trim();
    if (scope) {
      oauthUrl.searchParams.set("scope", scope);
    }

    res.redirect(oauthUrl.toString());
  });

  app.get("/api/auth/wix/callback", authRateLimiter, async (req, res) => {
    try {
      await userStoreReady;
      const { code = "", state = "", error = "" } = req.query || {};
      if (error) {
        res.status(401).json({ error: `Wix OAuth failed: ${error}` });
        return;
      }

      const decodedState = decodeState(state, sessionSecret);
      if (!decodedState || !Number.isFinite(decodedState.ts) || Date.now() - decodedState.ts > OAUTH_STATE_TTL_MS) {
        res.status(400).json({ error: "Invalid or expired OAuth state." });
        return;
      }
      if (!code || typeof code !== "string") {
        res.status(400).json({ error: "Missing OAuth authorization code." });
        return;
      }

      const redirectUri = wixRedirectUri(req);
      const accessToken = await exchangeWixAuthCode(code, redirectUri, wixFetch);
      if (!accessToken) {
        res.status(503).json({ error: "Could not exchange Wix OAuth code." });
        return;
      }

      const wixMember = await getWixMemberFromToken(accessToken, wixFetch);
      const identity = identityFromWixMember(wixMember);
      if (!identity.email || !identity.externalMemberId) {
        res.status(400).json({ error: "Wix OAuth member payload missing email or member ID." });
        return;
      }

      const user = await userStore.upsertUserFromIdentity(identity);
      const token = createSessionToken(
        { userId: user.id, exp: Date.now() + SESSION_TTL_MS },
        sessionSecret
      );
      res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: Math.floor(SESSION_TTL_MS / 1000)
      }));
      res.json({
        authenticated: true,
        user: userSummary(user),
        plan: resolvePlanForUser(user)
      });
    } catch (err) {
      res.status(500).json({ error: "Could not complete Wix OAuth sign in." });
    }
  });

  app.post("/api/auth/sso", authRateLimiter, async (req, res) => {
    try {
      await userStoreReady;
      if (!identityTrusted(req)) {
        res.status(401).json({ error: "Untrusted identity request." });
        return;
      }

      const identity = req.body && typeof req.body === "object" ? req.body : {};
      if (!identity.email || typeof identity.email !== "string") {
        res.status(400).json({ error: "Email is required." });
        return;
      }

      const user = await userStore.upsertUserFromIdentity(identity);
      const token = createSessionToken(
        { userId: user.id, exp: Date.now() + SESSION_TTL_MS },
        sessionSecret
      );
      res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: Math.floor(SESSION_TTL_MS / 1000)
      }));

      res.json({
        authenticated: true,
        user: userSummary(user),
        plan: resolvePlanForUser(user)
      });
    } catch (err) {
      if (err && /Conflicting identity match/i.test(err.message)) {
        res.status(409).json({ error: "Conflicting identity payload." });
        return;
      }
      res.status(500).json({ error: "Could not complete sign in." });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, "", {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0
    }));
    res.json({ ok: true });
  });

  app.post("/api/billing/webhook", async (req, res) => {
    try {
      await userStoreReady;
      if (!billingTrusted(req)) {
        res.status(401).json({ error: "Untrusted billing webhook." });
        return;
      }

      const update = req.body && typeof req.body === "object" ? req.body : {};
      const updatedUser = await userStore.updateUserBilling(update);
      if (!updatedUser) {
        res.status(404).json({ error: "User not found for billing update." });
        return;
      }

      res.json({
        ok: true,
        user: userSummary(updatedUser),
        plan: resolvePlanForUser(updatedUser)
      });
    } catch (err) {
      if (err && /Conflicting identity match/i.test(err.message)) {
        res.status(409).json({ error: "Conflicting billing identity." });
        return;
      }
      res.status(500).json({ error: "Could not process billing webhook." });
    }
  });

  app.post("/api/can-save", requireAuth, async (req, res) => {
    try {
      await userStoreReady;
      const check = await evaluateSaveAccessForUser(req.currentUser, userStore, wixFetch, wixClientTokenCache);
      if (check.user) {
        req.currentUser = check.user;
      }
      res.json({
        allowed: check.allowed,
        reason: check.reason,
        retentionMonths: RETENTION_MONTHS
      });
    } catch (_err) {
      res.status(503).json({ allowed: false, error: "Could not verify subscription access." });
    }
  });

  app.get("/api/store", async (req, res) => {
    try {
      await userStoreReady;
      const store = await readStore();
      const catalogStore = getUserStore(store, catalogScopeUserId(req));
      const projects = req.currentUser ? await userStore.listProjectsByUser(req.currentUser.id) : [];
      res.json({ ...catalogStore, projects });
    } catch (_err) {
      res.status(500).json({ error: "Could not load data store." });
    }
  });

  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      await userStoreReady;
      const projects = await userStore.listProjectsByUser(req.currentUser.id);
      res.json(projects);
    } catch (_err) {
      res.status(500).json({ error: "Could not load projects." });
    }
  });

  app.post("/api/projects", requireAuth, requireSubscriber, async (req, res) => {
    try {
      await userStoreReady;
      const project = await userStore.createProject(req.currentUser.id, req.body || {});
      res.status(201).json(project);
    } catch (err) {
      if (err && /Project name is required/i.test(err.message)) {
        res.status(400).json({ error: "Project name is required." });
        return;
      }
      res.status(500).json({ error: "Could not save project." });
    }
  });

  app.put("/api/projects/:id", requireAuth, requireSubscriber, async (req, res) => {
    try {
      await userStoreReady;
      const project = await userStore.updateProject(req.currentUser.id, req.params.id, req.body || {});
      if (!project) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      res.json(project);
    } catch (_err) {
      res.status(500).json({ error: "Could not update project." });
    }
  });

  app.delete("/api/projects/:id", requireAuth, requireSubscriber, async (req, res) => {
    try {
      await userStoreReady;
      const deleted = await userStore.deleteProject(req.currentUser.id, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Project not found." });
        return;
      }
      res.status(204).send();
    } catch (_err) {
      res.status(500).json({ error: "Could not delete project." });
    }
  });

  app.get("/api/presets", requireAuth, async (req, res) => {
    try {
      await userStoreReady;
      const presets = await userStore.listPresetsByUser(req.currentUser.id);
      res.json(presets);
    } catch (_err) {
      res.status(500).json({ error: "Could not load presets." });
    }
  });

  app.post("/api/presets", requireAuth, requireSubscriber, async (req, res) => {
    try {
      await userStoreReady;
      const preset = await userStore.createPreset(req.currentUser.id, req.body || {});
      res.status(201).json(preset);
    } catch (err) {
      if (err && /Preset type and name are required/i.test(err.message)) {
        res.status(400).json({ error: "Preset type and name are required." });
        return;
      }
      res.status(500).json({ error: "Could not save preset." });
    }
  });

  app.put("/api/presets/:id", requireAuth, requireSubscriber, async (req, res) => {
    try {
      await userStoreReady;
      const preset = await userStore.updatePreset(req.currentUser.id, req.params.id, req.body || {});
      if (!preset) {
        res.status(404).json({ error: "Preset not found." });
        return;
      }
      res.json(preset);
    } catch (_err) {
      res.status(500).json({ error: "Could not update preset." });
    }
  });

  app.delete("/api/presets/:id", requireAuth, requireSubscriber, async (req, res) => {
    try {
      await userStoreReady;
      const deleted = await userStore.deletePreset(req.currentUser.id, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Preset not found." });
        return;
      }
      res.status(204).send();
    } catch (_err) {
      res.status(500).json({ error: "Could not delete preset." });
    }
  });

  app.put("/api/settings", requireAuth, requireSubscriber, async (req, res) => {
    try {
      const body = req.body || {};
      const settings = await mutateLegacyStore(async (store) => {
        const userStoreRecord = getUserStore(store, catalogScopeUserId(req));
        userStoreRecord.settings = {
          ...userStoreRecord.settings,
          unitSystem: body.unitSystem === "metric" ? "metric" : "in",
          precision: typeof body.precision === "string" ? body.precision : userStoreRecord.settings.precision
        };
        return userStoreRecord.settings;
      });
      res.json(settings);
    } catch (_err) {
      res.status(500).json({ error: "Could not update settings." });
    }
  });

  function listHandlers({ listKey, pathBase }) {
    app.post(`/api/${pathBase}`, requireAuth, requireSubscriber, async (req, res) => {
      try {
        const item = await mutateLegacyStore(async (store) => {
          const userStoreRecord = getUserStore(store, catalogScopeUserId(req));
          const nextItem = { id: crypto.randomUUID(), ...(req.body || {}) };
          userStoreRecord[listKey].push(nextItem);
          return nextItem;
        });
        res.status(201).json(item);
      } catch (_err) {
        res.status(500).json({ error: `Could not save ${pathBase}.` });
      }
    });

    app.put(`/api/${pathBase}/:id`, requireAuth, requireSubscriber, async (req, res) => {
      try {
        const updated = await mutateLegacyStore(async (store) => {
          const userStoreRecord = getUserStore(store, catalogScopeUserId(req));
          const idx = userStoreRecord[listKey].findIndex((item) => item.id === req.params.id);
          if (idx < 0) {
            return null;
          }
          userStoreRecord[listKey][idx] = { ...userStoreRecord[listKey][idx], ...(req.body || {}) };
          return userStoreRecord[listKey][idx];
        });

        if (!updated) {
          return res.status(404).json({ error: "Item not found." });
        }

        res.json(updated);
      } catch (_err) {
        res.status(500).json({ error: `Could not update ${pathBase}.` });
      }
    });

    app.delete(`/api/${pathBase}/:id`, requireAuth, requireSubscriber, async (req, res) => {
      try {
        const deleted = await mutateLegacyStore(async (store) => {
          const userStoreRecord = getUserStore(store, catalogScopeUserId(req));
          const before = userStoreRecord[listKey].length;
          userStoreRecord[listKey] = userStoreRecord[listKey].filter((item) => item.id !== req.params.id);
          return userStoreRecord[listKey].length !== before;
        });

        if (!deleted) {
          return res.status(404).json({ error: "Item not found." });
        }

        res.status(204).send();
      } catch (_err) {
        res.status(500).json({ error: `Could not delete ${pathBase}.` });
      }
    });
  }

  listHandlers({ listKey: "doorStyles", pathBase: "door-styles" });
  listHandlers({ listKey: "overlayTemplates", pathBase: "overlay-templates" });
  listHandlers({ listKey: "drawerSlides", pathBase: "drawer-slides" });
  listHandlers({ listKey: "drawerConstructions", pathBase: "drawer-constructions" });

  app.locals.userStore = userStore;
  app.locals.userStoreReady = userStoreReady;
  return app;
}

async function startServer(options = {}) {
  const app = createApp(options);
  await app.locals.userStoreReady;
  const listenPort = options.port ?? PORT;
  return new Promise((resolve) => {
    const server = app.listen(listenPort, () => {
      console.log(`Door and Drawer Cutlister API running on port ${listenPort}`);
      resolve({ app, server });
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
  });
}

module.exports = {
  createApp,
  startServer,
  resolvePlanForUser,
  SESSION_COOKIE_NAME
};
