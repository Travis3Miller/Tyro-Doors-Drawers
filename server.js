const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "store.json");
const PUBLIC_USER_ID = "public";
const USER_ID_REGEX = /^[a-zA-Z0-9_-]{6,80}$/;
const SERVE_STATIC = process.env.SERVE_STATIC !== "false";

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

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed by CORS"));
  }
}));
app.use(express.json());

if (SERVE_STATIC) {
  app.use(express.static(__dirname));
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
    projects: [],
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
    projects: Array.isArray(source.projects) ? source.projects : [],
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

  const hasLegacyRoot = Boolean(
    Array.isArray(source.projects)
    || Array.isArray(source.doorStyles)
    || Array.isArray(source.overlayTemplates)
    || Array.isArray(source.drawerSlides)
    || Array.isArray(source.drawerConstructions)
    || source.settings
  );

  if (hasLegacyRoot && !users[PUBLIC_USER_ID]) {
    users[PUBLIC_USER_ID] = normalizeUserStore(source);
  }

  if (!Object.keys(users).length) {
    users[PUBLIC_USER_ID] = defaultUserStore();
  }

  return { users };
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeUserId(value) {
  if (!value) {
    return PUBLIC_USER_ID;
  }
  const safe = String(value).trim();
  if (!USER_ID_REGEX.test(safe)) {
    return PUBLIC_USER_ID;
  }
  return safe;
}

function requestUserId(req) {
  const raw = req.get("x-user-id") || "";
  return normalizeUserId(raw);
}

function getUserStore(store, userId) {
  if (!store.users[userId]) {
    store.users[userId] = defaultUserStore();
  }
  return store.users[userId];
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/store", async (req, res) => {
  try {
    const store = await readStore();
    const userStore = getUserStore(store, requestUserId(req));
    res.json(userStore);
  } catch (err) {
    res.status(500).json({ error: "Could not load data store." });
  }
});

app.get("/api/projects", async (req, res) => {
  try {
    const store = await readStore();
    const userStore = getUserStore(store, requestUserId(req));
    res.json(userStore.projects || []);
  } catch (err) {
    res.status(500).json({ error: "Could not load projects." });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { name, payload } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Project name is required." });
    }

    const store = await readStore();
    const userStore = getUserStore(store, requestUserId(req));
    const now = new Date().toISOString();
    const project = {
      id: newId(),
      name: name.trim(),
      payload: payload || {},
      createdAt: now,
      updatedAt: now
    };

    userStore.projects.push(project);
    await writeStore(store);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: "Could not save project." });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  try {
    const store = await readStore();
    const userStore = getUserStore(store, requestUserId(req));
    const idx = (userStore.projects || []).findIndex((p) => p.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Project not found." });
    }

    const existing = userStore.projects[idx];
    const { name, payload } = req.body || {};

    const updated = {
      ...existing,
      name: typeof name === "string" ? name.trim() : existing.name,
      payload: payload !== undefined ? payload : existing.payload,
      updatedAt: new Date().toISOString()
    };

    userStore.projects[idx] = updated;
    await writeStore(store);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Could not update project." });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const store = await readStore();
    const userStore = getUserStore(store, requestUserId(req));
    const before = userStore.projects.length;
    userStore.projects = userStore.projects.filter((p) => p.id !== req.params.id);

    if (userStore.projects.length === before) {
      return res.status(404).json({ error: "Project not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete project." });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const store = await readStore();
    const userStore = getUserStore(store, requestUserId(req));
    const body = req.body || {};
    userStore.settings = {
      ...userStore.settings,
      unitSystem: body.unitSystem === "metric" ? "metric" : "in",
      precision: typeof body.precision === "string" ? body.precision : userStore.settings.precision
    };
    await writeStore(store);
    res.json(userStore.settings);
  } catch (err) {
    res.status(500).json({ error: "Could not update settings." });
  }
});

function listHandlers({ listKey, pathBase }) {
  app.post(`/api/${pathBase}`, async (req, res) => {
    try {
      const store = await readStore();
      const userStore = getUserStore(store, requestUserId(req));
      const item = { id: newId(), ...(req.body || {}) };
      userStore[listKey].push(item);
      await writeStore(store);
      res.status(201).json(item);
    } catch (err) {
      res.status(500).json({ error: `Could not save ${pathBase}.` });
    }
  });

  app.put(`/api/${pathBase}/:id`, async (req, res) => {
    try {
      const store = await readStore();
      const userStore = getUserStore(store, requestUserId(req));
      const idx = userStore[listKey].findIndex((item) => item.id === req.params.id);

      if (idx < 0) {
        return res.status(404).json({ error: "Item not found." });
      }

      userStore[listKey][idx] = { ...userStore[listKey][idx], ...(req.body || {}) };
      await writeStore(store);
      res.json(userStore[listKey][idx]);
    } catch (err) {
      res.status(500).json({ error: `Could not update ${pathBase}.` });
    }
  });

  app.delete(`/api/${pathBase}/:id`, async (req, res) => {
    try {
      const store = await readStore();
      const userStore = getUserStore(store, requestUserId(req));
      const before = userStore[listKey].length;
      userStore[listKey] = userStore[listKey].filter((item) => item.id !== req.params.id);

      if (userStore[listKey].length === before) {
        return res.status(404).json({ error: "Item not found." });
      }

      await writeStore(store);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: `Could not delete ${pathBase}.` });
    }
  });
}

listHandlers({ listKey: "doorStyles", pathBase: "door-styles" });
listHandlers({ listKey: "overlayTemplates", pathBase: "overlay-templates" });
listHandlers({ listKey: "drawerSlides", pathBase: "drawer-slides" });
listHandlers({ listKey: "drawerConstructions", pathBase: "drawer-constructions" });

app.listen(PORT, () => {
  console.log(`Door and Drawer Cutlister API running on port ${PORT}`);
});
