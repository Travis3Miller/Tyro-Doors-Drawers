function byId(id) {
  return document.getElementById(id);
}

const LOCAL_CATALOG_KEY = "cutlister.catalog.v1";
const LOCAL_PROJECTS_KEY = "cutlister.projects.v1";
const LOCAL_SETTINGS_KEY = "cutlister.settings.v1";
const USER_ID_STORAGE_KEY = "cutlister.userId.v1";

const FRONTEND_CONFIG = window.CUTLISTER_CONFIG || {};
const API_BASE_URL = typeof FRONTEND_CONFIG.apiBaseUrl === "string"
  ? FRONTEND_CONFIG.apiBaseUrl.trim().replace(/\/+$/, "")
  : "";
const ASSET_BASE_URL = typeof FRONTEND_CONFIG.assetBaseUrl === "string"
  ? FRONTEND_CONFIG.assetBaseUrl.trim().replace(/\/+$/, "")
  : "";

function createUserId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `user-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

function getClientUserId() {
  let userId = localStorage.getItem(USER_ID_STORAGE_KEY);
  if (!userId) {
    userId = createUserId();
    localStorage.setItem(USER_ID_STORAGE_KEY, userId);
  }
  return userId;
}

function apiUrl(path) {
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with '/': ${path}`);
  }
  if (!API_BASE_URL) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

function assetUrl(assetName) {
  const cleanName = String(assetName || "").replace(/^\/+/, "");
  if (ASSET_BASE_URL) {
    const encodedPath = cleanName.split("/").map((part) => encodeURIComponent(part)).join("/");
    return `${ASSET_BASE_URL}/${encodedPath}`;
  }
  if (API_BASE_URL) {
    return `${API_BASE_URL}/api/assets/${encodeURIComponent(cleanName)}`;
  }
  return cleanName;
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("x-user-id", getClientUserId());
  const requestOptions = { ...options, headers };
  if (!requestOptions.credentials) {
    requestOptions.credentials = "include";
  }
  return fetch(apiUrl(path), requestOptions);
}

async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) {
        message = data.error;
      }
    } catch (_err) {
      // Ignore parse errors and use generic message.
    }
    throw new Error(message);
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

const state = {
  dataMode: "unknown",
  catalog: {
    doorStyles: [],
    overlayTemplates: [],
    drawerSlides: [],
    drawerConstructions: []
  },
  projects: [],
  settings: { unitSystem: "in", precision: "1/16" },
  ui: {
    doorInputMode: "size",
    drawerInputMode: "opening",
    doorCutSort: { key: "", direction: "asc", lastMeasureKey: "", lastMeasureDirection: "desc" },
    lastDoorResults: null,
    constructionStep: 1
  }
};

const UNIT_PRECISION_OPTIONS = {
  in: [
    { value: "1/16", label: "1/16 in" },
    { value: "1/32", label: "1/32 in" },
    { value: "1/64", label: "1/64 in" }
  ],
  metric: [
    { value: "0.1", label: "0.1 mm" },
    { value: "0.01", label: "0.01 mm" },
    { value: "0.001", label: "0.001 mm" }
  ]
};

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

function normalizeCatalog(catalog) {
  const defaults = defaultCatalog();
  const normalizeConstruction = (item) => {
    const base = {
      constructionType: item.constructionType || "butt",
      sideThickness: item.sideThickness,
      frontBackThickness: item.frontBackThickness,
      bottomThickness: item.bottomThickness,
      bottomInset: item.bottomInset,
      bottomAdjustWidth: item.bottomAdjustWidth,
      bottomAdjustLength: item.bottomAdjustLength,
      buttSideRun: item.buttSideRun || "length",
      buttBottomPlacement: item.buttBottomPlacement || "grooved",
      buttGrooveDepth: item.buttGrooveDepth,
      buttGrooveHeight: item.buttGrooveHeight,
      buttGrooveSides: item.buttGrooveSides !== undefined ? item.buttGrooveSides : true,
      buttGrooveFront: item.buttGrooveFront !== undefined ? item.buttGrooveFront : true,
      buttGrooveBack: item.buttGrooveBack !== undefined ? item.buttGrooveBack : false,
      dovetailMode: item.dovetailMode || "through",
      dovetailFrontSetbackEnabled: item.dovetailFrontSetbackEnabled || false,
      dovetailBackSetbackEnabled: item.dovetailBackSetbackEnabled || false,
      dovetailFrontSetback: item.dovetailFrontSetback,
      dovetailBackSetback: item.dovetailBackSetback,
      customFrontRipSign: item.customFrontRipSign || "sub",
      customFrontRipOffset: item.customFrontRipOffset,
      customBackRipSign: item.customBackRipSign || "sub",
      customBackRipOffset: item.customBackRipOffset,
      customSideRipSign: item.customSideRipSign || "sub",
      customSideRipOffset: item.customSideRipOffset,
      customFrontLenSign: item.customFrontLenSign || "sub",
      customFrontLenOffset: item.customFrontLenOffset,
      customBackLenSign: item.customBackLenSign || "sub",
      customBackLenOffset: item.customBackLenOffset,
      customSideLenSign: item.customSideLenSign || "sub",
      customSideLenOffset: item.customSideLenOffset,
      customBottomWidthBasis: item.customBottomWidthBasis || "width",
      customBottomWidthSign: item.customBottomWidthSign || "sub",
      customBottomWidthOffset: item.customBottomWidthOffset,
      customBottomLengthBasis: item.customBottomLengthBasis || "depth",
      customBottomLengthSign: item.customBottomLengthSign || "sub",
      customBottomLengthOffset: item.customBottomLengthOffset,
      lockSideRun: item.lockSideRun || "length",
      lockDadoDepth: item.lockDadoDepth,
      bottomThicknessIncluded: item.bottomThicknessIncluded || false
    };

    if (!Number.isFinite(base.bottomAdjustWidth)) {
      base.bottomAdjustWidth = Number.isFinite(item.bottomInset) ? item.bottomInset * 2 : 0.0625;
    }
    if (!Number.isFinite(base.bottomAdjustLength)) {
      base.bottomAdjustLength = Number.isFinite(item.bottomInset) ? item.bottomInset * 2 : 0.0625;
    }
    if (!Number.isFinite(base.lockDadoDepth)) {
      base.lockDadoDepth = 0.25;
    }
    if (!Number.isFinite(base.dovetailFrontSetback)) {
      base.dovetailFrontSetback = 0;
    }
    if (!Number.isFinite(base.dovetailBackSetback)) {
      base.dovetailBackSetback = 0;
    }
    if (!Number.isFinite(base.customFrontRipOffset)) {
      base.customFrontRipOffset = 0;
    }
    if (!Number.isFinite(base.customBackRipOffset)) {
      base.customBackRipOffset = 0;
    }
    if (!Number.isFinite(base.customSideRipOffset)) {
      base.customSideRipOffset = 0;
    }
    if (!Number.isFinite(base.customFrontLenOffset)) {
      base.customFrontLenOffset = 0;
    }
    if (!Number.isFinite(base.customBackLenOffset)) {
      base.customBackLenOffset = 0;
    }
    if (!Number.isFinite(base.customSideLenOffset)) {
      base.customSideLenOffset = 0;
    }
    if (!Number.isFinite(base.customBottomWidthOffset)) {
      base.customBottomWidthOffset = 0;
    }
    if (!Number.isFinite(base.customBottomLengthOffset)) {
      base.customBottomLengthOffset = 0;
    }

    return { ...item, ...base };
  };
  return {
    doorStyles: Array.isArray(catalog.doorStyles) && catalog.doorStyles.length ? catalog.doorStyles : defaults.doorStyles,
    overlayTemplates: Array.isArray(catalog.overlayTemplates) && catalog.overlayTemplates.length ? catalog.overlayTemplates : defaults.overlayTemplates,
    drawerSlides: Array.isArray(catalog.drawerSlides) && catalog.drawerSlides.length ? catalog.drawerSlides : defaults.drawerSlides,
    drawerConstructions: Array.isArray(catalog.drawerConstructions) && catalog.drawerConstructions.length
      ? catalog.drawerConstructions.map(normalizeConstruction)
      : defaults.drawerConstructions
  };
}

function normalizeSettings(settings) {
  return { ...defaultSettings(), ...(settings || {}) };
}

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_err) {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function localSettings() {
  return normalizeSettings(readLocalJson(LOCAL_SETTINGS_KEY, defaultSettings()));
}

function saveLocalSettings(settings) {
  writeLocalJson(LOCAL_SETTINGS_KEY, settings);
}

async function ensureDataMode() {
  if (state.dataMode !== "unknown") {
    return state.dataMode;
  }

  try {
    const res = await apiFetch("/api/store");
    if (!res.ok) {
      throw new Error("Api unavailable");
    }
    state.dataMode = "api";
  } catch (_err) {
    state.dataMode = "local";
  }

  return state.dataMode;
}

function localCatalog() {
  return normalizeCatalog(readLocalJson(LOCAL_CATALOG_KEY, defaultCatalog()));
}

function saveLocalCatalog(catalog) {
  writeLocalJson(LOCAL_CATALOG_KEY, catalog);
}

function localProjects() {
  return readLocalJson(LOCAL_PROJECTS_KEY, []);
}

function saveLocalProjects(projects) {
  writeLocalJson(LOCAL_PROJECTS_KEY, projects);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gcd(a, b) {
  if (!b) {
    return a;
  }
  return gcd(b, a % b);
}

function parseFraction(value) {
  if (value === null || value === undefined) {
    return NaN;
  }
  const raw = String(value).trim();
  if (!raw) {
    return NaN;
  }

  const sign = raw.startsWith("-") ? -1 : 1;
  const normalized = raw.replace(/-/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  const safe = normalized.replace(/^\+/, "");
  const parts = safe.split(" ");

  let total = 0;
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (part.includes("/")) {
      const [numRaw, denRaw] = part.split("/");
      const num = Number(numRaw);
      const den = Number(denRaw);
      if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
        return NaN;
      }
      total += num / den;
    } else {
      const num = Number(part);
      if (!Number.isFinite(num)) {
        return NaN;
      }
      total += num;
    }
  }

  return total * sign;
}

function precisionStep() {
  if (state.settings.unitSystem === "metric") {
    return Number(state.settings.precision) || 0.01;
  }
  const parts = state.settings.precision.split("/");
  const denom = Number(parts[1]) || 16;
  return 1 / denom;
}

function roundToPrecision(value) {
  const step = precisionStep();
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

function formatFraction(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const parts = state.settings.precision.split("/");
  const denom = Number(parts[1]) || 16;
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  let whole = Math.floor(absValue + 1e-8);
  let numerator = Math.round((absValue - whole) * denom);

  if (numerator === denom) {
    whole += 1;
    numerator = 0;
  }

  if (numerator === 0) {
    return `${sign}${whole}`;
  }

  const factor = gcd(numerator, denom);
  const reducedNum = numerator / factor;
  const reducedDen = denom / factor;

  if (whole === 0) {
    return `${sign}${reducedNum}/${reducedDen}`;
  }

  return `${sign}${whole} ${reducedNum}/${reducedDen}`;
}

function parseMeasurement(value) {
  if (state.settings.unitSystem === "metric") {
    const parsed = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return parseFraction(value);
}

function formatMeasurement(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (state.settings.unitSystem === "metric") {
    const step = precisionStep();
    const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
    return roundToPrecision(value).toFixed(decimals);
  }
  return formatFraction(value);
}

function toYesNo(value) {
  return value ? "Yes" : "No";
}

function fmt(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return formatMeasurement(value);
}

async function loadCatalog() {
  if (await ensureDataMode() === "api") {
    const store = await apiJson("/api/store");
    state.catalog = normalizeCatalog(store);
    state.projects = Array.isArray(store.projects) ? store.projects : [];
    state.settings = normalizeSettings(store.settings);
  } else {
    state.catalog = localCatalog();
    state.projects = localProjects();
    state.settings = localSettings();
  }

  async function refreshWelcomeBanner() {
    const banner = byId("welcomeBanner");
    if (!banner) {
      return;
    }
    banner.textContent = "Welcome";

    if (await ensureDataMode() !== "api") {
      return;
    }

    try {
      const session = await apiJson("/api/auth/session");
      if (session && session.authenticated && session.user) {
        const displayName = session.user.name || session.user.email || "there";
        banner.textContent = `Welcome, ${displayName}`;
      }
    } catch (_err) {
      banner.textContent = "Welcome";
    }
  }
}

async function refreshUi() {
  populateProjectSelect();
  renderDoorStyles();
  renderOverlayTemplates();
  renderDrawerSlides();
  renderDrawerConstructions();
  ensureDefaultRows();
  ensureDoorSizeRows();
  ensureDoorOpeningRows();
  ensureDrawerOpeningRows();
  ensureDrawerBoxRows();
  populateDoorStyleSelects();
  populateDrawerInputSelects();
  updateSettingsUi();
  updateUnitLabels();
  wireMeasurementInputs();
  formatAllMeasurementInputs();
  updateInputModeUi();
  renderInputSummaries();
}

function populateDoorStyleSelects() {
  const doorStyleSelect = byId("doorStyleSelect");
  const doorOpeningStyleSelect = byId("doorOpeningStyleSelect");
  if (doorStyleSelect) {
    doorStyleSelect.innerHTML = "";
    doorStyleOptions().forEach((option) => doorStyleSelect.appendChild(option));
  }
  if (doorOpeningStyleSelect) {
    doorOpeningStyleSelect.innerHTML = "";
    doorStyleOptions().forEach((option) => doorOpeningStyleSelect.appendChild(option));
  }
}

function populateDrawerInputSelects() {
  const openingSlideSelect = byId("drawerOpeningSlideSelect");
  const openingConstructionSelect = byId("drawerOpeningConstructionSelect");
  const boxSlideSelect = byId("drawerBoxSlideSelect");
  const boxConstructionSelect = byId("drawerBoxConstructionSelect");

  if (openingSlideSelect) {
    openingSlideSelect.innerHTML = "";
    slideOptions().forEach((option) => openingSlideSelect.appendChild(option));
  }
  if (openingConstructionSelect) {
    openingConstructionSelect.innerHTML = "";
    constructionOptions().forEach((option) => openingConstructionSelect.appendChild(option));
  }
  if (boxSlideSelect) {
    boxSlideSelect.innerHTML = "";
    slideOptions().forEach((option) => boxSlideSelect.appendChild(option));
  }
  if (boxConstructionSelect) {
    boxConstructionSelect.innerHTML = "";
    constructionOptions().forEach((option) => boxConstructionSelect.appendChild(option));
  }
}

function updateInputModeUi() {
  const doorSizeBtn = byId("doorInputSizeBtn");
  const doorOpeningBtn = byId("doorInputOpeningBtn");
  const doorSizeSection = byId("doorSizeSection");
  const doorOpeningSection = byId("doorOpeningSection");
  const doorCalculateBtn = byId("calculateDoorsBtn");

  if (doorSizeBtn && doorOpeningBtn && doorSizeSection && doorOpeningSection) {
    const isSize = state.ui.doorInputMode === "size";
    doorSizeBtn.classList.toggle("active", isSize);
    doorOpeningBtn.classList.toggle("active", !isSize);
    doorSizeSection.classList.toggle("hidden", !isSize);
    doorOpeningSection.classList.toggle("hidden", isSize);
    if (doorCalculateBtn) {
      doorCalculateBtn.textContent = isSize ? "Generate Cutlist" : "Generate Door List & Cutlist";
    }
  }

  const drawerOpeningBtn = byId("drawerInputOpeningBtn");
  const drawerBoxBtn = byId("drawerInputBoxBtn");
  const drawerOpeningSection = byId("drawerOpeningSection");
  const drawerBoxSection = byId("drawerBoxSection");

  if (drawerOpeningBtn && drawerBoxBtn && drawerOpeningSection && drawerBoxSection) {
    const isOpening = state.ui.drawerInputMode === "opening";
    drawerOpeningBtn.classList.toggle("active", isOpening);
    drawerBoxBtn.classList.toggle("active", !isOpening);
    drawerOpeningSection.classList.toggle("hidden", !isOpening);
    drawerBoxSection.classList.toggle("hidden", isOpening);
  }
}

function renderInputSummaries() {
  const drawerOpeningSummary = byId("drawerOpeningSummary");
  const drawerBoxSummary = byId("drawerBoxSummary");

  if (drawerOpeningSummary) {
    const rows = readDrawerOpeningRows().filter((row) => Number.isFinite(row.openingWidth) && Number.isFinite(row.openingHeight));
    drawerOpeningSummary.innerHTML = rows.length
      ? rows
          .map((row) => {
            const slide = getSlide(row.slideId);
            return `<div><strong>${slide.name}</strong>: ${fmt(row.openingWidth)} x ${fmt(row.openingHeight)} (Qty ${row.drawerCount})</div>`;
          })
          .join("")
      : "<div>No drawer openings added yet.</div>";
  }

  if (drawerBoxSummary) {
    const rows = readDrawerBoxRows().filter((row) => Number.isFinite(row.boxWidth) && Number.isFinite(row.boxHeight));
    drawerBoxSummary.innerHTML = rows.length
      ? rows
          .map((row) => {
            const construction = getConstruction(row.constructionId);
            return `<div><strong>${construction.name}</strong>: ${fmt(row.boxWidth)} x ${fmt(row.boxHeight)} (Qty ${row.qty})</div>`;
          })
          .join("")
      : "<div>No drawer boxes added yet.</div>";
  }
}

function populateProjectSelect() {
  const select = byId("projectSelect");
  select.innerHTML = '<option value="">Select a saved project</option>';
  state.projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    select.appendChild(option);
  });
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function updateSettingsUi() {
  const unitSelect = byId("unitSystemSelect");
  const precisionSelect = byId("precisionSelect");
  if (!unitSelect || !precisionSelect) {
    return;
  }

  unitSelect.value = state.settings.unitSystem;
  precisionSelect.innerHTML = "";
  const options = UNIT_PRECISION_OPTIONS[state.settings.unitSystem] || UNIT_PRECISION_OPTIONS.in;
  options.forEach((option) => precisionSelect.appendChild(createOption(option.value, option.label)));

  if (options.some((option) => option.value === state.settings.precision)) {
    precisionSelect.value = state.settings.precision;
  } else {
    precisionSelect.value = options[0].value;
    state.settings.precision = options[0].value;
  }
}

function updateUnitLabels() {
  const unitLabel = state.settings.unitSystem === "metric" ? "mm" : "in";
  document.querySelectorAll("label").forEach((label) => {
    const text = label.childNodes[0]?.nodeValue;
    if (!text) {
      return;
    }
    if (text.includes("(in)") || text.includes("(mm)")) {
      label.childNodes[0].nodeValue = text.replace(/\((in|mm)\)/g, `(${unitLabel})`);
    }
  });
}

function doorStyleOptions(selectedId = "") {
  return state.catalog.doorStyles.map((style) => {
    const option = createOption(style.id, style.name);
    if (style.id === selectedId) {
      option.selected = true;
    }
    return option;
  });
}

function overlayOptions(selectedId = "") {
  return state.catalog.overlayTemplates.map((template) => {
    const option = createOption(template.id, template.name);
    if (template.id === selectedId) {
      option.selected = true;
    }
    return option;
  });
}

function slideOptions(selectedId = "") {
  return state.catalog.drawerSlides.map((slide) => {
    const option = createOption(slide.id, slide.name);
    if (slide.id === selectedId) {
      option.selected = true;
    }
    return option;
  });
}

function constructionOptions(selectedId = "") {
  return state.catalog.drawerConstructions.map((item) => {
    const option = createOption(item.id, item.name);
    if (item.id === selectedId) {
      option.selected = true;
    }
    return option;
  });
}

function ensureDefaultRows() {
  ensureDrawerOpeningRows();
  ensureDrawerBoxRows();
}

function ensureDoorSizeRows(count = 10) {
  const body = byId("doorSizeTableBody");
  if (!body) {
    return;
  }
  const existing = body.querySelectorAll("tr").length;
  const toAdd = Math.max(0, count - existing);
  for (let i = 0; i < toAdd; i += 1) {
    addDoorSizeRow();
  }
}

function ensureDoorOpeningRows(count = 10) {
  const body = byId("doorOpeningTableBody");
  if (!body) {
    return;
  }
  const existing = body.querySelectorAll("tr").length;
  const toAdd = Math.max(0, count - existing);
  for (let i = 0; i < toAdd; i += 1) {
    addOpeningRow();
  }
}

function ensureDrawerOpeningRows(count = 10) {
  const body = byId("drawerOpeningTableBody");
  if (!body) {
    return;
  }
  const existing = body.querySelectorAll("tr").length;
  const toAdd = Math.max(0, count - existing);
  for (let i = 0; i < toAdd; i += 1) {
    addDrawerOpeningRow();
  }
}

function ensureDrawerBoxRows(count = 10) {
  const body = byId("drawerBoxTableBody");
  if (!body) {
    return;
  }
  const existing = body.querySelectorAll("tr").length;
  const toAdd = Math.max(0, count - existing);
  for (let i = 0; i < toAdd; i += 1) {
    addDrawerBoxRow();
  }
}

function createRowInput({ label, type = "number", value = "", step = "0.01", min = "0", isMeasure = false }) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  input.type = isMeasure ? "text" : type;
  if (isMeasure) {
    input.inputMode = "decimal";
    input.dataset.measure = "true";
  }
  if (!isMeasure && type === "number") {
    input.step = step;
    input.min = min;
  }
  input.value = isMeasure && Number.isFinite(value) ? formatMeasurement(value) : value;
  wrap.appendChild(input);
  return { wrap, input };
}

function createRowSelect({ label, options, value = "" }) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const select = document.createElement("select");
  options.forEach((option) => select.appendChild(option));
  if (value) {
    select.value = value;
  }
  wrap.appendChild(select);
  return { wrap, select };
}

function createRowActions(onRemove) {
  const actions = document.createElement("div");
  actions.className = "list-item-actions";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "Remove";
  removeBtn.className = "danger";
  removeBtn.addEventListener("click", onRemove);
  actions.appendChild(removeBtn);
  return actions;
}

function addDoorRow(values = {}) {
  addDoorSizeRow(values);
}

function addDoorSizeRow(values = {}) {
  const body = byId("doorSizeTableBody");
  if (!body) {
    return;
  }
  const row = document.createElement("tr");

  const qtyCell = document.createElement("td");
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "0";
  qtyInput.step = "1";
  qtyInput.value = values.qty ?? "";
  qtyCell.appendChild(qtyInput);

  const widthCell = document.createElement("td");
  const widthInput = document.createElement("input");
  widthInput.type = "text";
  widthInput.inputMode = "decimal";
  widthInput.dataset.measure = "true";
  widthInput.value = Number.isFinite(values.width) ? formatMeasurement(values.width) : "";
  widthCell.appendChild(widthInput);

  const heightCell = document.createElement("td");
  const heightInput = document.createElement("input");
  heightInput.type = "text";
  heightInput.inputMode = "decimal";
  heightInput.dataset.measure = "true";
  heightInput.value = Number.isFinite(values.height) ? formatMeasurement(values.height) : "";
  heightCell.appendChild(heightInput);

  const cabinetCell = document.createElement("td");
  const cabinetInput = document.createElement("input");
  cabinetInput.type = "text";
  cabinetInput.placeholder = "Optional";
  cabinetInput.value = values.cabinetNumber || "";
  cabinetCell.appendChild(cabinetInput);

  row.append(qtyCell, widthCell, heightCell, cabinetCell);
  body.appendChild(row);
  wireMeasurementInputs();
}

function addOpeningRow(values = {}) {
  const body = byId("doorOpeningTableBody");
  if (!body) {
    return;
  }
  const row = document.createElement("tr");

  const overlayCell = document.createElement("td");
  const overlaySelect = document.createElement("select");
  overlayOptions(values.overlayId).forEach((option) => overlaySelect.appendChild(option));
  overlayCell.appendChild(overlaySelect);

  const widthCell = document.createElement("td");
  const widthInput = document.createElement("input");
  widthInput.type = "text";
  widthInput.inputMode = "decimal";
  widthInput.dataset.measure = "true";
  widthInput.value = Number.isFinite(values.openingWidth) ? formatMeasurement(values.openingWidth) : "";
  widthCell.appendChild(widthInput);

  const heightCell = document.createElement("td");
  const heightInput = document.createElement("input");
  heightInput.type = "text";
  heightInput.inputMode = "decimal";
  heightInput.dataset.measure = "true";
  heightInput.value = Number.isFinite(values.openingHeight) ? formatMeasurement(values.openingHeight) : "";
  heightCell.appendChild(heightInput);

  const countCell = document.createElement("td");
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.step = "1";
  countInput.value = values.doorCount ?? "";
  countCell.appendChild(countInput);

  const cabinetCell = document.createElement("td");
  const cabinetInput = document.createElement("input");
  cabinetInput.type = "text";
  cabinetInput.placeholder = "Optional";
  cabinetInput.value = values.cabinetNumber || "";
  cabinetCell.appendChild(cabinetInput);

  row.append(overlayCell, widthCell, heightCell, countCell, cabinetCell);
  body.appendChild(row);
  updateUnitLabels();
  wireMeasurementInputs();
}

function addDrawerOpeningRow(values = {}) {
  const body = byId("drawerOpeningTableBody");
  if (!body) {
    return;
  }
  const row = document.createElement("tr");

  const widthCell = document.createElement("td");
  const widthInput = document.createElement("input");
  widthInput.type = "text";
  widthInput.inputMode = "decimal";
  widthInput.dataset.measure = "true";
  widthInput.value = Number.isFinite(values.openingWidth) ? formatMeasurement(values.openingWidth) : "";
  widthCell.appendChild(widthInput);

  const heightCell = document.createElement("td");
  const heightInput = document.createElement("input");
  heightInput.type = "text";
  heightInput.inputMode = "decimal";
  heightInput.dataset.measure = "true";
  heightInput.value = Number.isFinite(values.openingHeight) ? formatMeasurement(values.openingHeight) : "";
  heightCell.appendChild(heightInput);

  const depthCell = document.createElement("td");
  const depthInput = document.createElement("input");
  depthInput.type = "text";
  depthInput.inputMode = "decimal";
  depthInput.dataset.measure = "true";
  depthInput.value = Number.isFinite(values.openingDepth) ? formatMeasurement(values.openingDepth) : "";
  depthCell.appendChild(depthInput);

  const countCell = document.createElement("td");
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.step = "1";
  countInput.value = values.drawerCount ?? "";
  countCell.appendChild(countInput);

  const modeCell = document.createElement("td");
  const modeSelect = document.createElement("select");
  modeSelect.appendChild(createOption("equal", "Equal Split"));
  modeSelect.appendChild(createOption("topFixed", "Top Fixed"));
  modeSelect.value = values.heightMode || "equal";
  modeCell.appendChild(modeSelect);

  const topCell = document.createElement("td");
  const topInput = document.createElement("input");
  topInput.type = "text";
  topInput.inputMode = "decimal";
  topInput.dataset.measure = "true";
  topInput.value = Number.isFinite(values.topOpeningHeight) ? formatMeasurement(values.topOpeningHeight) : "";
  topCell.appendChild(topInput);

  row.append(widthCell, heightCell, depthCell, countCell, modeCell, topCell);
  body.appendChild(row);
  updateUnitLabels();
  wireMeasurementInputs();
}

function addDrawerBoxRow(values = {}) {
  const body = byId("drawerBoxTableBody");
  if (!body) {
    return;
  }
  const row = document.createElement("tr");

  const widthCell = document.createElement("td");
  const widthInput = document.createElement("input");
  widthInput.type = "text";
  widthInput.inputMode = "decimal";
  widthInput.dataset.measure = "true";
  widthInput.value = Number.isFinite(values.boxWidth) ? formatMeasurement(values.boxWidth) : "";
  widthCell.appendChild(widthInput);

  const heightCell = document.createElement("td");
  const heightInput = document.createElement("input");
  heightInput.type = "text";
  heightInput.inputMode = "decimal";
  heightInput.dataset.measure = "true";
  heightInput.value = Number.isFinite(values.boxHeight) ? formatMeasurement(values.boxHeight) : "";
  heightCell.appendChild(heightInput);

  const depthCell = document.createElement("td");
  const depthInput = document.createElement("input");
  depthInput.type = "text";
  depthInput.inputMode = "decimal";
  depthInput.dataset.measure = "true";
  depthInput.value = Number.isFinite(values.boxDepth) ? formatMeasurement(values.boxDepth) : "";
  depthCell.appendChild(depthInput);

  const qtyCell = document.createElement("td");
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.step = "1";
  qtyInput.value = values.qty ?? "";
  qtyCell.appendChild(qtyInput);

  row.append(widthCell, heightCell, depthCell, qtyCell);
  body.appendChild(row);
  updateUnitLabels();
  wireMeasurementInputs();
}

function readDoorRows() {
  const body = byId("doorSizeTableBody");
  if (!body) {
    return [];
  }
  return Array.from(body.querySelectorAll("tr")).map((row) => {
    const inputs = row.querySelectorAll("input");
    const width = parseMeasurement(inputs[1]?.value);
    const height = parseMeasurement(inputs[2]?.value);
    const rawQty = Math.round(toNumber(inputs[0]?.value));
    const qty = rawQty > 0 ? rawQty : (Number.isFinite(width) || Number.isFinite(height) ? 1 : 0);
    return {
      qty,
      width,
      height,
      cabinetNumber: inputs[3]?.value?.trim() || ""
    };
  }).filter((row) => row.qty > 0 || Number.isFinite(row.width) || Number.isFinite(row.height));
}

function readOpeningRows() {
  const body = byId("doorOpeningTableBody");
  if (!body) {
    return [];
  }
  return Array.from(body.querySelectorAll("tr")).map((row) => {
    const inputs = row.querySelectorAll("input, select");
    const width = parseMeasurement(inputs[1]?.value);
    const height = parseMeasurement(inputs[2]?.value);
    const rawCount = Math.round(toNumber(inputs[3]?.value));
    const doorCount = rawCount > 0 ? rawCount : (Number.isFinite(width) || Number.isFinite(height) ? 1 : 0);
    return {
      overlayId: inputs[0]?.value,
      openingWidth: width,
      openingHeight: height,
      doorCount,
      cabinetNumber: inputs[4]?.value?.trim() || ""
    };
  }).filter((row) => row.doorCount > 0 || Number.isFinite(row.openingWidth) || Number.isFinite(row.openingHeight));
}

function readDrawerOpeningRows() {
  const body = byId("drawerOpeningTableBody");
  if (!body) {
    return [];
  }
  const slideId = byId("drawerOpeningSlideSelect")?.value || "";
  const constructionId = byId("drawerOpeningConstructionSelect")?.value || "";
  return Array.from(body.querySelectorAll("tr")).map((row) => {
    const inputs = row.querySelectorAll("input, select");
    const width = parseMeasurement(inputs[0]?.value);
    const height = parseMeasurement(inputs[1]?.value);
    const depth = parseMeasurement(inputs[2]?.value);
    const rawCount = Math.round(toNumber(inputs[3]?.value));
    const drawerCount = rawCount > 0 ? rawCount : (Number.isFinite(width) || Number.isFinite(height) || Number.isFinite(depth) ? 1 : 0);
    return {
      slideId,
      constructionId,
      openingWidth: width,
      openingHeight: height,
      openingDepth: depth,
      drawerCount,
      heightMode: inputs[4]?.value || "equal",
      topOpeningHeight: parseMeasurement(inputs[5]?.value)
    };
  }).filter((row) => row.drawerCount > 0 || Number.isFinite(row.openingWidth) || Number.isFinite(row.openingHeight) || Number.isFinite(row.openingDepth));
}

function readDrawerBoxRows() {
  const body = byId("drawerBoxTableBody");
  if (!body) {
    return [];
  }
  const constructionId = byId("drawerBoxConstructionSelect")?.value || "";
  return Array.from(body.querySelectorAll("tr")).map((row) => {
    const inputs = row.querySelectorAll("input");
    const width = parseMeasurement(inputs[0]?.value);
    const height = parseMeasurement(inputs[1]?.value);
    const depth = parseMeasurement(inputs[2]?.value);
    const rawQty = Math.round(toNumber(inputs[3]?.value));
    const qty = rawQty > 0 ? rawQty : (Number.isFinite(width) || Number.isFinite(height) || Number.isFinite(depth) ? 1 : 0);
    return {
      constructionId,
      boxWidth: width,
      boxHeight: height,
      boxDepth: depth,
      qty
    };
  }).filter((row) => row.qty > 0 || Number.isFinite(row.boxWidth) || Number.isFinite(row.boxHeight) || Number.isFinite(row.boxDepth));
}

function getDoorStyle(id) {
  return state.catalog.doorStyles.find((style) => style.id === id) || state.catalog.doorStyles[0];
}

function getOverlay(id) {
  return state.catalog.overlayTemplates.find((item) => item.id === id) || state.catalog.overlayTemplates[0];
}

function getSlide(id) {
  return state.catalog.drawerSlides.find((item) => item.id === id) || state.catalog.drawerSlides[0];
}

function getConstruction(id) {
  return state.catalog.drawerConstructions.find((item) => item.id === id) || state.catalog.drawerConstructions[0];
}

function doorPartsForSize({ width, height, style, qty }) {
  const grooveDepth = Number.isFinite(style.grooveDepth)
    ? style.grooveDepth
    : Number.isFinite(style.stickDepth)
      ? style.stickDepth
      : style.copeDepth;
  const matchRails = Boolean(style.matchRailsToStiles);
  const baseRailWidth = matchRails ? style.stileWidth : style.railWidth;
  const topRailWidth = style.customTopRail && Number.isFinite(style.topRailWidth)
    ? style.topRailWidth
    : baseRailWidth;
  const oversize = style.oversizeEnabled ? style.oversizeAmount || 0 : 0;
  const adjustedWidth = width + oversize;
  const adjustedHeight = height + oversize;
  const ripOversize = oversize / 2;
  const stileWidth = style.stileWidth + ripOversize;
  const bottomRailWidth = baseRailWidth + ripOversize;
  const topRailWidthAdj = topRailWidth + ripOversize;
  const jointDepth = grooveDepth;
  const railLength = adjustedWidth - 2 * stileWidth + 2 * jointDepth;
  const panelWidth = railLength - style.panelClearance;
  const panelHeight = adjustedHeight - (topRailWidthAdj - grooveDepth) - (bottomRailWidth - grooveDepth);
  const railsMatch = Math.abs(topRailWidthAdj - bottomRailWidth) < 1e-6;
  const rails = railsMatch
    ? [{ label: "Rail", length: railLength, width: bottomRailWidth, qty: 2 * qty }]
    : [
        { label: "Bottom Rail", length: railLength, width: bottomRailWidth, qty: 1 * qty },
        { label: "Top Rail", length: railLength, width: topRailWidthAdj, qty: 1 * qty }
      ];

  return [
    { label: "Stile", length: adjustedHeight, width: stileWidth, qty: 2 * qty },
    ...rails,
    { label: "Panel", length: panelHeight, width: panelWidth, qty }
  ];
}

function doorSizesFromOpenings(openings) {
  const sizes = [];
  const styleSelect = byId("doorOpeningStyleSelect");
  const style = getDoorStyle(styleSelect ? styleSelect.value : "");
  openings.forEach((opening) => {
    const overlay = getOverlay(opening.overlayId);
    if (!Number.isFinite(opening.openingWidth) || !Number.isFinite(opening.openingHeight)) {
      return;
    }
    const doorWidthTotal = opening.openingWidth + overlay.left + overlay.right;
    const doorHeight = opening.openingHeight + overlay.top + overlay.bottom;

    const count = Math.max(1, opening.doorCount || 1);
    const gap = overlay.gap || 0;

    if (count === 1) {
      sizes.push({
        width: doorWidthTotal,
        height: doorHeight,
        qty: 1,
        overlayName: overlay.name,
        style,
        cabinetNumber: opening.cabinetNumber
      });
    } else {
      const eachWidth = (doorWidthTotal - gap) / count;
      sizes.push({
        width: eachWidth,
        height: doorHeight,
        qty: count,
        overlayName: overlay.name,
        style,
        cabinetNumber: opening.cabinetNumber
      });
    }
  });

  return sizes;
}

function aggregateParts(parts) {
  const map = new Map();
  parts.forEach((part) => {
    const key = `${part.label}|${roundToPrecision(part.length).toFixed(6)}|${roundToPrecision(part.width).toFixed(6)}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += part.qty;
    } else {
      map.set(key, { ...part });
    }
  });
  return Array.from(map.values());
}

function getCabinetSortValue(cabinetNumbers) {
  if (!cabinetNumbers) {
    return "";
  }
  const tokens = cabinetNumbers.split(",").map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) {
    return "";
  }
  const numericTokens = tokens
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value));
  if (numericTokens.length) {
    return Math.min(...numericTokens);
  }
  return tokens[0];
}

function sortDoorParts(parts, sortState) {
  if (!sortState || !sortState.key) {
    return [...parts];
  }

  const primaryKey = sortState.key;
  const primaryDir = sortState.direction === "desc" ? -1 : 1;
  const measureKey = sortState.lastMeasureKey;
  const measureDir = sortState.lastMeasureDirection === "desc" ? -1 : 1;

  const compareMeasure = (a, b, key, dir) => {
    if (!key) {
      return 0;
    }
    const diff = (a[key] || 0) - (b[key] || 0);
    if (diff === 0) {
      return 0;
    }
    return diff * dir;
  };

  const compareCabinet = (a, b) => {
    const aVal = getCabinetSortValue(a.cabinetNumbers);
    const bVal = getCabinetSortValue(b.cabinetNumbers);
    if (aVal === bVal) {
      return 0;
    }
    return aVal > bVal ? 1 : -1;
  };

  const comparePartGroup = (label) => {
    if (label === "Stile") {
      return 1;
    }
    if (label === "Rail") {
      return 2;
    }
    return 3;
  };

  return [...parts].sort((a, b) => {
    let diff = 0;
    if (primaryKey === "width" || primaryKey === "length") {
      diff = compareMeasure(a, b, primaryKey, primaryDir);
      if (diff === 0) {
        const secondaryKey = primaryKey === "width" ? "length" : "width";
        diff = compareMeasure(a, b, secondaryKey, primaryDir);
      }
    } else if (primaryKey === "part") {
      const groupDiff = comparePartGroup(a.label) - comparePartGroup(b.label);
      diff = groupDiff !== 0 ? groupDiff : a.label.localeCompare(b.label);
      if (diff === 0) {
        diff = compareMeasure(a, b, measureKey, measureDir);
      }
    } else if (primaryKey === "cabinet") {
      diff = compareCabinet(a, b) * primaryDir;
      if (diff === 0) {
        diff = compareMeasure(a, b, measureKey, measureDir);
      }
    }

    return diff;
  });
}

function updateDoorCutSort(key) {
  const current = state.ui.doorCutSort || { key: "", direction: "asc", lastMeasureKey: "", lastMeasureDirection: "desc" };
  const isSameKey = current.key === key;
  const isMeasure = key === "width" || key === "length";
  const nextDirection = isSameKey ? (current.direction === "asc" ? "desc" : "asc") : (isMeasure ? "desc" : "asc");

  const next = {
    key,
    direction: nextDirection,
    lastMeasureKey: current.lastMeasureKey,
    lastMeasureDirection: current.lastMeasureDirection
  };

  if (isMeasure) {
    next.lastMeasureKey = key;
    next.lastMeasureDirection = nextDirection;
  }

  state.ui.doorCutSort = next;
  if (state.ui.lastDoorResults) {
    const { doorList, stileRailParts, panelParts } = state.ui.lastDoorResults;
    const sortedStileRails = sortDoorParts(stileRailParts, next);
    const sortedPanels = sortDoorParts(panelParts, next);
    renderDoorResults({ doorList, stileRailParts: sortedStileRails, panelParts: sortedPanels });
  } else {
    calculateDoorCutlist();
  }
}

function renderDoorResults({ doorList, stileRailParts, panelParts }) {
  const results = byId("doorResults");
  results.innerHTML = "";

  if (!doorList.length) {
    results.innerHTML = "<p class=\"help\">Add doors or openings to calculate.</p>";
    return;
  }

  const doorCard = document.createElement("div");
  doorCard.className = "result-card";
  doorCard.innerHTML = "<h4>Door List</h4>";
  const doorTable = document.createElement("table");
  doorTable.className = "result-table";
  doorTable.innerHTML = "<thead><tr><th>Door #</th><th>Cabinet #</th><th>Style</th><th>Width</th><th>Height</th></tr></thead>";
  const doorBody = document.createElement("tbody");
  doorList.forEach((door) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${door.doorNumber}</td><td>${door.cabinetNumber || ""}</td><td>${door.styleName}</td><td>${fmt(door.width)}</td><td>${fmt(door.height)}</td>`;
    doorBody.appendChild(row);
  });
  doorTable.appendChild(doorBody);
  doorCard.appendChild(doorTable);

  const buildCutlistCard = (title, parts, tableId) => {
    const cutCard = document.createElement("div");
    cutCard.className = "result-card";
    cutCard.innerHTML = `<h4>${title}</h4>`;
    const cutTable = document.createElement("table");
    cutTable.className = "result-table";
    cutTable.id = tableId;
    cutTable.innerHTML = "<thead><tr>"
      + "<th>Qty</th>"
      + "<th class=\"sortable\" data-sort=\"width\"><span class=\"sort-label\">Width (Rip)<span class=\"sort-arrow\"></span></span></th>"
      + "<th class=\"sortable\" data-sort=\"length\"><span class=\"sort-label\">Length<span class=\"sort-arrow\"></span></span></th>"
      + "<th class=\"sortable\" data-sort=\"part\"><span class=\"sort-label\">Part<span class=\"sort-arrow\"></span></span></th>"
      + "<th class=\"sortable\" data-sort=\"cabinet\"><span class=\"sort-label\">Cabinet #<span class=\"sort-arrow\"></span></span></th>"
      + "</tr></thead>";
    const cutBody = document.createElement("tbody");
    parts.forEach((part) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${part.qty}</td><td>${fmt(part.width)}</td><td>${fmt(part.length)}</td><td>${part.label}</td><td>${part.cabinetNumbers}</td>`;
      cutBody.appendChild(row);
    });
    cutTable.appendChild(cutBody);
    cutCard.appendChild(cutTable);
    return cutCard;
  };

  const stileRailCard = buildCutlistCard("Stiles & Rails Cutlist", stileRailParts, "stileRailCutlist");
  const panelCard = buildCutlistCard("Panel Cutlist", panelParts, "panelCutlist");

  const sortState = state.ui.doorCutSort;
  results.append(doorCard, stileRailCard, panelCard);

  results.querySelectorAll("th.sortable").forEach((cell) => {
    const key = cell.dataset.sort;
    if (sortState && sortState.key === key) {
      cell.classList.add(sortState.direction === "asc" ? "sorted-asc" : "sorted-desc");
    }
    cell.addEventListener("click", () => updateDoorCutSort(key));
  });
}

function calculateDoorCutlist() {
  const doorRows = state.ui.doorInputMode === "size" ? readDoorRows() : [];
  const openingRows = state.ui.doorInputMode === "opening" ? readOpeningRows() : [];
  const openingSizes = doorSizesFromOpenings(openingRows);
  const sizeStyleSelect = byId("doorStyleSelect");
  const sizeStyle = getDoorStyle(sizeStyleSelect ? sizeStyleSelect.value : "");

  const doorList = [];
  const parts = [];
  let sequence = 1;

  const formatDoorNumber = (cabinetNumber, index, total) => {
    if (cabinetNumber) {
      return total > 1 ? `${cabinetNumber}-${index + 1}` : cabinetNumber;
    }
    const value = sequence;
    sequence += 1;
    return String(value);
  };

  doorRows.forEach((row) => {
    if (!Number.isFinite(row.width) || !Number.isFinite(row.height) || row.width <= 0 || row.height <= 0 || row.qty <= 0) {
      return;
    }
    const qty = Math.max(1, row.qty || 1);
    for (let i = 0; i < qty; i += 1) {
      const doorNumber = formatDoorNumber(row.cabinetNumber, i, qty);
      doorList.push({
        doorNumber,
        cabinetNumber: row.cabinetNumber,
        styleName: sizeStyle.name,
        width: row.width,
        height: row.height
      });
      const partList = doorPartsForSize({ width: row.width, height: row.height, style: sizeStyle, qty: 1 });
      partList.forEach((part) => {
        parts.push({
          label: part.label,
          length: part.length,
          width: part.width,
          qty: part.qty,
          cabinetNumber: row.cabinetNumber
        });
      });
    }
  });

  openingSizes.forEach((size) => {
    const qty = Math.max(1, size.qty || 1);
    for (let i = 0; i < qty; i += 1) {
      const doorNumber = formatDoorNumber(size.cabinetNumber, i, qty);
      doorList.push({
        doorNumber,
        cabinetNumber: size.cabinetNumber,
        styleName: `${size.style.name} (${size.overlayName})`,
        width: size.width,
        height: size.height
      });
      const partList = doorPartsForSize({ width: size.width, height: size.height, style: size.style, qty: 1 });
      partList.forEach((part) => {
        parts.push({
          label: part.label,
          length: part.length,
          width: part.width,
          qty: part.qty,
          cabinetNumber: size.cabinetNumber
        });
      });
    }
  });

  const aggregated = aggregateDoorParts(parts);
  const stileRailParts = aggregated.filter((part) => part.label !== "Panel");
  const panelParts = aggregated.filter((part) => part.label === "Panel");
  const sortState = state.ui.doorCutSort;
  const sortedStileRails = sortDoorParts(stileRailParts, sortState);
  const sortedPanels = sortDoorParts(panelParts, sortState);
  const results = { doorList, stileRailParts: sortedStileRails, panelParts: sortedPanels };
  state.ui.lastDoorResults = results;
  renderDoorResults(results);
}

function aggregateDoorParts(parts) {
  const map = new Map();
  parts.forEach((part) => {
    const key = `${part.label}|${roundToPrecision(part.length).toFixed(6)}|${roundToPrecision(part.width).toFixed(6)}`;
    const cabinet = part.cabinetNumber ? String(part.cabinetNumber).trim() : "";
    if (map.has(key)) {
      const existing = map.get(key);
      existing.qty += part.qty || 1;
      if (cabinet) {
        existing.cabinetSet.add(cabinet);
      }
    } else {
      map.set(key, {
        label: part.label,
        length: part.length,
        width: part.width,
        qty: part.qty || 1,
        cabinetSet: cabinet ? new Set([cabinet]) : new Set()
      });
    }
  });

  return Array.from(map.values()).map((entry) => ({
    label: entry.label,
    length: entry.length,
    width: entry.width,
    qty: entry.qty,
    cabinetNumbers: entry.cabinetSet.size ? Array.from(entry.cabinetSet).join(", ") : ""
  }));
}

function drawerBoxesFromOpenings(openings) {
  const boxes = [];

  openings.forEach((opening) => {
    const slide = getSlide(opening.slideId);
    const construction = getConstruction(opening.constructionId);
    if (!slide || !construction) {
      return;
    }
    if (!Number.isFinite(opening.openingWidth) || !Number.isFinite(opening.openingHeight) || !Number.isFinite(opening.openingDepth)) {
      return;
    }

    const usableWidth = opening.openingWidth - 2 * slide.sideClearance;
    const usableDepth = opening.openingDepth - slide.depthClearance;
    const count = Math.max(1, opening.drawerCount || 1);

    let heights = [];
    if (count === 1) {
      heights = [opening.openingHeight];
    } else if (opening.heightMode === "topFixed" && opening.topOpeningHeight > 0) {
      const remaining = Math.max(0, opening.openingHeight - opening.topOpeningHeight);
      const each = remaining / (count - 1 || 1);
      heights = [opening.topOpeningHeight, ...Array.from({ length: count - 1 }, () => each)];
    } else {
      heights = Array.from({ length: count }, () => opening.openingHeight / count);
    }

    heights.forEach((openingHeight) => {
      const usableHeight = openingHeight - slide.topClearance - slide.bottomClearance;
      boxes.push({
        width: usableWidth,
        height: usableHeight,
        depth: usableDepth,
        qty: 1,
        slideName: slide.name,
        construction
      });
    });
  });

  return boxes;
}

function drawerPartsForBox(box, construction, qty) {
  const sideQty = 2 * qty;
  const frontBackQty = 2 * qty;
  const bottomQty = 1 * qty;
  const type = construction.constructionType || "butt";
  const sideRunsLength = (construction.buttSideRun || "length") === "length";
  const isLock = type === "lock";
  const isButt = type === "butt";
  const isDovetail = type === "dovetail";
  const isCustom = type === "custom";
  const lockSideRun = construction.lockSideRun || "length";
  const lockDadoDepth = Number.isFinite(construction.lockDadoDepth) ? construction.lockDadoDepth : 0;
  const lockThickness = Number.isFinite(construction.sideThickness) ? construction.sideThickness : 0;

  if (isCustom) {
    const applyAdjust = (base, sign, offset) => base + (sign === "add" ? offset : -offset);
    const frontRip = applyAdjust(
      box.height,
      construction.customFrontRipSign,
      Number.isFinite(construction.customFrontRipOffset) ? construction.customFrontRipOffset : 0
    );
    const backRip = applyAdjust(
      box.height,
      construction.customBackRipSign,
      Number.isFinite(construction.customBackRipOffset) ? construction.customBackRipOffset : 0
    );
    const sideRip = applyAdjust(
      box.height,
      construction.customSideRipSign,
      Number.isFinite(construction.customSideRipOffset) ? construction.customSideRipOffset : 0
    );
    const frontLength = applyAdjust(
      box.width,
      construction.customFrontLenSign,
      Number.isFinite(construction.customFrontLenOffset) ? construction.customFrontLenOffset : 0
    );
    const backLength = applyAdjust(
      box.width,
      construction.customBackLenSign,
      Number.isFinite(construction.customBackLenOffset) ? construction.customBackLenOffset : 0
    );
    const sideLength = applyAdjust(
      box.depth,
      construction.customSideLenSign,
      Number.isFinite(construction.customSideLenOffset) ? construction.customSideLenOffset : 0
    );
    const bottomWidthBase = construction.customBottomWidthBasis === "depth" ? box.depth : box.width;
    const bottomLengthBase = construction.customBottomLengthBasis === "width" ? box.width : box.depth;
    const bottomWidth = applyAdjust(
      bottomWidthBase,
      construction.customBottomWidthSign,
      Number.isFinite(construction.customBottomWidthOffset) ? construction.customBottomWidthOffset : 0
    );
    const bottomLength = applyAdjust(
      bottomLengthBase,
      construction.customBottomLengthSign,
      Number.isFinite(construction.customBottomLengthOffset) ? construction.customBottomLengthOffset : 0
    );

    return [
      { label: "Drawer Side", length: sideLength, width: sideRip, thickness: construction.sideThickness, qty: sideQty },
      { label: "Drawer Front", length: frontLength, width: frontRip, thickness: construction.frontBackThickness, qty: qty },
      { label: "Drawer Back", length: backLength, width: backRip, thickness: construction.frontBackThickness, qty: qty },
      { label: "Drawer Bottom", length: bottomLength, width: bottomWidth, thickness: construction.bottomThickness, qty: bottomQty }
    ];
  }

  if (isDovetail) {
    const mode = construction.dovetailMode || "through";
    const frontEnabled = Boolean(construction.dovetailFrontSetbackEnabled);
    const backEnabled = Boolean(construction.dovetailBackSetbackEnabled);
    const frontSetback = mode === "setback" && frontEnabled
      ? (Number.isFinite(construction.dovetailFrontSetback) ? construction.dovetailFrontSetback : 0)
      : 0;
    const backSetback = mode === "setback" && backEnabled
      ? (Number.isFinite(construction.dovetailBackSetback) ? construction.dovetailBackSetback : 0)
      : 0;
    const frontBackLength = box.width;
    const sideLength = Math.max(0, box.depth - frontSetback - backSetback);
    const innerWidth = box.width - 2 * construction.sideThickness;
    const innerDepth = box.depth - 2 * construction.frontBackThickness;
    const bottomAdjustWidth = Number.isFinite(construction.bottomAdjustWidth) ? construction.bottomAdjustWidth : 0;
    const bottomAdjustLength = Number.isFinite(construction.bottomAdjustLength) ? construction.bottomAdjustLength : 0;
    const bottomWidth = innerWidth - bottomAdjustWidth;
    const bottomDepth = innerDepth - bottomAdjustLength;

    return [
      { label: "Drawer Side", length: sideLength, width: box.height, thickness: construction.sideThickness, qty: sideQty },
      { label: "Drawer Front/Back", length: frontBackLength, width: box.height, thickness: construction.frontBackThickness, qty: frontBackQty },
      { label: "Drawer Bottom", length: Math.max(0, bottomDepth), width: Math.max(0, bottomWidth), thickness: construction.bottomThickness, qty: bottomQty }
    ];
  }

  if (isLock) {
    const sidesRunLength = lockSideRun === "length";
    const frontBackLength = sidesRunLength
      ? box.width - 2 * lockThickness + 2 * lockDadoDepth
      : box.width;
    const sideLength = sidesRunLength
      ? box.depth
      : box.depth - 2 * lockThickness + 2 * lockDadoDepth;
    const bottomWidth = box.width - 2 * construction.bottomInset;
    const bottomDepth = box.depth - 2 * construction.bottomInset;

    return [
      { label: "Drawer Side", length: sideLength, width: box.height, thickness: construction.sideThickness, qty: sideQty },
      { label: "Drawer Front/Back", length: frontBackLength, width: box.height, thickness: construction.frontBackThickness, qty: frontBackQty },
      { label: "Drawer Bottom", length: Math.max(0, bottomDepth), width: Math.max(0, bottomWidth), thickness: construction.bottomThickness, qty: bottomQty }
    ];
  }
  const frontBackLength = sideRunsLength
    ? box.width - 2 * construction.sideThickness
    : box.width;
  const sideLength = sideRunsLength
    ? box.depth
    : box.depth - 2 * construction.frontBackThickness;

  const innerWidth = box.width - 2 * construction.sideThickness;
  const innerDepth = box.depth - 2 * construction.frontBackThickness;
  const bottomAdjustWidth = Number.isFinite(construction.bottomAdjustWidth) ? construction.bottomAdjustWidth : 0;
  const bottomAdjustLength = Number.isFinite(construction.bottomAdjustLength) ? construction.bottomAdjustLength : 0;

  let bottomWidth = innerWidth - bottomAdjustWidth;
  let bottomDepth = innerDepth - bottomAdjustLength;

  if (isButt && construction.buttBottomPlacement === "grooved") {
    const grooveDepth = Number.isFinite(construction.buttGrooveDepth) ? construction.buttGrooveDepth : 0;
    const grooveWidth = Number.isFinite(construction.bottomThickness) ? construction.bottomThickness : 0;
    const grooveHeight = Number.isFinite(construction.buttGrooveHeight) ? construction.buttGrooveHeight : 0;
    const grooveSides = Boolean(construction.buttGrooveSides);
    const grooveFront = Boolean(construction.buttGrooveFront);
    const grooveBack = Boolean(construction.buttGrooveBack);

    if (grooveSides) {
      bottomWidth += grooveDepth * 2;
    }
    if (grooveFront) {
      bottomDepth += grooveDepth;
    }
    if (grooveBack) {
      bottomDepth += grooveDepth;
    }

    const heightDrop = grooveHeight + grooveWidth;
    const sideHeight = grooveSides ? box.height : box.height - heightDrop;
    const frontHeight = grooveFront ? box.height : box.height - heightDrop;
    const backHeight = grooveBack ? box.height : box.height - heightDrop;

    return [
      { label: "Drawer Side", length: sideLength, width: Math.max(0, sideHeight), thickness: construction.sideThickness, qty: sideQty },
      { label: "Drawer Front", length: frontBackLength, width: Math.max(0, frontHeight), thickness: construction.frontBackThickness, qty: qty },
      { label: "Drawer Back", length: frontBackLength, width: Math.max(0, backHeight), thickness: construction.frontBackThickness, qty: qty },
      { label: "Drawer Bottom", length: Math.max(0, bottomDepth), width: Math.max(0, bottomWidth), thickness: construction.bottomThickness, qty: bottomQty }
    ];
  }

  return [
    { label: "Drawer Side", length: sideLength, width: box.height, thickness: construction.sideThickness, qty: sideQty },
    { label: "Drawer Front/Back", length: frontBackLength, width: box.height, thickness: construction.frontBackThickness, qty: frontBackQty },
    { label: "Drawer Bottom", length: Math.max(0, bottomDepth), width: Math.max(0, bottomWidth), thickness: construction.bottomThickness, qty: bottomQty }
  ];
}

function renderDrawerResults({ entries, parts }) {
  const results = byId("drawerResults");
  results.innerHTML = "";

  if (!entries.length) {
    results.innerHTML = "<p class=\"help\">Add drawer openings or boxes to calculate.</p>";
    return;
  }

  const detailCard = document.createElement("div");
  detailCard.className = "result-card";
  detailCard.innerHTML = "<h4>Drawer Boxes</h4>";
  const detailTable = document.createElement("table");
  detailTable.className = "result-table";
  detailTable.innerHTML = "<thead><tr><th>Construction</th><th>Width</th><th>Height</th><th>Depth</th><th>Qty</th></tr></thead>";
  const detailBody = document.createElement("tbody");
  entries.forEach((entry) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${entry.constructionName}</td><td>${fmt(entry.width)}</td><td>${fmt(entry.height)}</td><td>${fmt(entry.depth)}</td><td>${entry.qty}</td>`;
    detailBody.appendChild(row);
  });
  detailTable.appendChild(detailBody);
  detailCard.appendChild(detailTable);

  const cutCard = document.createElement("div");
  cutCard.className = "result-card";
  cutCard.innerHTML = "<h4>Cutlist</h4>";
  const cutTable = document.createElement("table");
  cutTable.className = "result-table";
  cutTable.innerHTML = "<thead><tr><th>Part</th><th>Length</th><th>Width</th><th>Thk</th><th>Qty</th></tr></thead>";
  const cutBody = document.createElement("tbody");
  parts.forEach((part) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${part.label}</td><td>${fmt(part.length)}</td><td>${fmt(part.width)}</td><td>${fmt(part.thickness)}</td><td>${part.qty}</td>`;
    cutBody.appendChild(row);
  });
  cutTable.appendChild(cutBody);
  cutCard.appendChild(cutTable);

  results.append(detailCard, cutCard);
}

function calculateDrawerCutlist() {
  const openingRows = state.ui.drawerInputMode === "opening" ? readDrawerOpeningRows() : [];
  const boxRows = state.ui.drawerInputMode === "box" ? readDrawerBoxRows() : [];

  const openingBoxes = drawerBoxesFromOpenings(openingRows);
  const allEntries = [];
  const allParts = [];

  openingBoxes.forEach((box) => {
    if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || !Number.isFinite(box.depth)) {
      return;
    }
    if (box.width <= 0 || box.height <= 0 || box.depth <= 0) {
      return;
    }
    allEntries.push({
      width: box.width,
      height: box.height,
      depth: box.depth,
      qty: box.qty,
      constructionName: box.construction.name
    });
    allParts.push(...drawerPartsForBox(box, box.construction, box.qty));
  });

  boxRows.forEach((row) => {
    if (!Number.isFinite(row.boxWidth) || !Number.isFinite(row.boxHeight) || !Number.isFinite(row.boxDepth)) {
      return;
    }
    if (row.boxWidth <= 0 || row.boxHeight <= 0 || row.boxDepth <= 0) {
      return;
    }
    const construction = getConstruction(row.constructionId);
    allEntries.push({
      width: row.boxWidth,
      height: row.boxHeight,
      depth: row.boxDepth,
      qty: row.qty,
      constructionName: construction.name
    });
    allParts.push(...drawerPartsForBox({ width: row.boxWidth, height: row.boxHeight, depth: row.boxDepth }, construction, row.qty));
  });

  renderDrawerResults({ entries: allEntries, parts: aggregateParts(allParts) });
}

async function saveProject() {
  const name = byId("projectName").value.trim();
  if (!name) {
    alert("Project name is required.");
    return;
  }

  const payload = {
    doors: readDoorRows(),
    openings: readOpeningRows(),
    drawerOpenings: readDrawerOpeningRows(),
    drawerBoxes: readDrawerBoxRows(),
    doorInputMode: state.ui.doorInputMode,
    drawerInputMode: state.ui.drawerInputMode,
    doorSizeStyleId: byId("doorStyleSelect")?.value || "",
    doorOpeningStyleId: byId("doorOpeningStyleSelect")?.value || "",
    drawerOpeningSlideId: byId("drawerOpeningSlideSelect")?.value || "",
    drawerOpeningConstructionId: byId("drawerOpeningConstructionSelect")?.value || "",
    drawerBoxSlideId: byId("drawerBoxSlideSelect")?.value || "",
    drawerBoxConstructionId: byId("drawerBoxConstructionSelect")?.value || ""
  };

  const existingId = byId("projectSelect").value;

  if (await ensureDataMode() === "api") {
    if (existingId) {
      await apiJson(`/api/projects/${existingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, payload })
      });
    } else {
      await apiJson("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, payload })
      });
    }
  } else {
    const projects = localProjects();
    if (existingId) {
      const idx = projects.findIndex((project) => project.id === existingId);
      if (idx >= 0) {
        projects[idx] = { ...projects[idx], name, payload, updatedAt: new Date().toISOString() };
      }
    } else {
      projects.push({ id: Math.random().toString(36).slice(2, 10), name, payload, createdAt: new Date().toISOString() });
    }
    saveLocalProjects(projects);
  }

  await loadCatalog();
  await refreshUi();
}

function wireMeasurementInputs() {
  document.querySelectorAll("input[data-measure='true']").forEach((input) => {
    if (input.dataset.wired === "true") {
      return;
    }
    input.dataset.wired = "true";
    input.addEventListener("blur", () => {
      const value = parseMeasurement(input.value);
      if (!Number.isFinite(value)) {
        return;
      }
      input.value = formatMeasurement(value);
    });
  });
}

function formatAllMeasurementInputs() {
  document.querySelectorAll("input[data-measure='true']").forEach((input) => {
    const value = parseMeasurement(input.value);
    if (!Number.isFinite(value)) {
      return;
    }
    input.value = formatMeasurement(value);
  });
}

function updateRailInputsVisibility() {
  const jointType = byId("newDoorJointType").value;
  const matchRails = byId("matchRailsToStiles");
  const railWrap = byId("railWidthsWrap");
  const referenceImage = byId("doorReferenceImage");
  const referenceCaption = byId("doorReferenceCaption");
  const referenceTitle = byId("doorReferenceTitle");
  if (!matchRails || !railWrap) {
    return;
  }

  if (jointType === "mitered") {
    matchRails.checked = true;
    matchRails.disabled = true;
    if (referenceImage) {
      referenceImage.src = assetUrl("Bottom Groove Location and Depth(Square).png");
      referenceImage.alt = "Mitered door reference showing mitered rail/stile construction.";
    }
    if (referenceTitle) {
      referenceTitle.textContent = "Mitered Door Reference";
    }
    if (referenceCaption) {
      referenceCaption.textContent = "Mitered Door Reference (rails and stiles are equal width).";
    }
  } else {
    matchRails.disabled = false;
    if (referenceImage) {
      referenceImage.src = assetUrl("Bottom Groove Location and Depth.png");
      referenceImage.alt = "Cope N Stick reference showing X for stile/rail width, Y for groove distance, Z for panel clearance.";
    }
    if (referenceTitle) {
      referenceTitle.textContent = "Cope N Stick Reference";
    }
    if (referenceCaption) {
      referenceCaption.textContent = "Cope N Stick Reference: X = stile/rail width, Y = groove distance, Z = panel size offset vs rail.";
    }
  }

  railWrap.style.display = matchRails.checked ? "none" : "grid";
}

function updateConstructionInputsVisibility() {
  const typeSelect = byId("newConstructionType");
  const bottomPlacement = byId("newButtBottomPlacement");
  const bottomPlacementWrap = byId("bottomPlacementWrap");
  const grooveFields = byId("grooveFields");
  const bottomAdjustWrap = byId("bottomAdjustWrap");
  const lockDadoWrap = byId("lockDadoDepthWrap");
  const sideRunWrap = byId("sideRunWrap");
  const dovetailModeWrap = byId("dovetailModeWrap");
  const dovetailMode = byId("newDovetailMode");
  const dovetailSetbackWrap = byId("dovetailSetbackWrap");
  const dovetailFrontEnabled = byId("dovetailFrontSetbackEnabled");
  const dovetailBackEnabled = byId("dovetailBackSetbackEnabled");
  const dovetailFrontSetback = byId("newDovetailFrontSetback");
  const dovetailBackSetback = byId("newDovetailBackSetback");
  const frontBackThkWrap = byId("constructionFrontBackThkWrap");
  const sideThk = byId("newConstructionSideThk");
  const frontBackThk = byId("newConstructionFrontThk");
  const constructionName = byId("newConstructionName");
  const customSizingWrap = byId("customSizingWrap");
  const referenceGroup = byId("constructionReferenceGroup");
  const bottomThicknessWrap = byId("bottomThicknessWrap");
  const customConfirmWrap = byId("customConfirmWrap");
  const bottomThicknessIncludedWrap = byId("bottomThicknessIncludedWrap");
  const bottomThicknessIncluded = byId("newBottomThicknessIncluded");
  const grooveDepth = byId("newButtGrooveDepth");
  const grooveHeight = byId("newButtGrooveHeight");
  const grooveSides = byId("newButtGrooveSides");
  const grooveFront = byId("newButtGrooveFront");
  const grooveBack = byId("newButtGrooveBack");
  if (!bottomPlacement || !grooveFields) {
    return;
  }

  if (lockDadoWrap && typeSelect) {
    lockDadoWrap.style.display = typeSelect.value === "lock" ? "grid" : "none";
  }

  if (constructionName && typeSelect) {
    const selected = typeSelect.options[typeSelect.selectedIndex];
    const labelText = selected ? selected.textContent.trim() : "Construction";
    constructionName.placeholder = labelText || "Construction";
  }

  if (frontBackThkWrap && frontBackThk && sideThk && typeSelect) {
    const isLock = typeSelect.value === "lock";
    frontBackThkWrap.style.display = isLock ? "none" : "grid";
    frontBackThk.disabled = isLock;
    if (isLock) {
      frontBackThk.value = sideThk.value;
    }
  }

  if (sideRunWrap && typeSelect) {
    sideRunWrap.style.display = typeSelect.value === "dovetail" || typeSelect.value === "custom" ? "none" : "grid";
  }
  const sideRunInput = byId("newConstructionSideRun");
  if (sideRunInput && typeSelect) {
    sideRunInput.disabled = typeSelect.value === "dovetail" || typeSelect.value === "custom";
  }
  if (dovetailModeWrap && typeSelect) {
    dovetailModeWrap.classList.toggle("hidden", typeSelect.value !== "dovetail");
  }
  if (dovetailSetbackWrap && typeSelect && dovetailMode) {
    const showSetback = typeSelect.value === "dovetail" && dovetailMode.value === "setback";
    dovetailSetbackWrap.classList.toggle("hidden", !showSetback);
    [dovetailFrontEnabled, dovetailBackEnabled, dovetailFrontSetback, dovetailBackSetback].forEach((field) => {
      if (field) {
        field.disabled = !showSetback;
      }
    });
    if (showSetback) {
      if (dovetailFrontSetback && dovetailFrontEnabled) {
        dovetailFrontSetback.disabled = !dovetailFrontEnabled.checked;
      }
      if (dovetailBackSetback && dovetailBackEnabled) {
        dovetailBackSetback.disabled = !dovetailBackEnabled.checked;
      }
    }
  }

  if (customSizingWrap && typeSelect) {
    customSizingWrap.classList.toggle("hidden", typeSelect.value !== "custom");
  }

  if (customConfirmWrap && typeSelect) {
    customConfirmWrap.classList.toggle("hidden", typeSelect.value !== "custom");
  }

  if (referenceGroup && typeSelect) {
    referenceGroup.classList.toggle("hidden", typeSelect.value === "custom");
  }

  if (bottomPlacementWrap && typeSelect) {
    bottomPlacementWrap.style.display = typeSelect.value === "custom" ? "none" : "grid";
  }
  if (bottomThicknessWrap && typeSelect) {
    bottomThicknessWrap.style.display = typeSelect.value === "custom" ? "none" : "grid";
  }
  if (grooveFields && typeSelect) {
    grooveFields.style.display = typeSelect.value === "custom" ? "none" : "grid";
  }
  if (bottomAdjustWrap && typeSelect) {
    bottomAdjustWrap.style.display = typeSelect.value === "custom" ? "none" : "grid";
  }

  if (bottomThicknessIncludedWrap && bottomPlacement) {
    const isPlanted = bottomPlacement.value === "planted";
    bottomThicknessIncludedWrap.style.display = isPlanted ? "flex" : "none";
    if (bottomThicknessIncluded) {
      bottomThicknessIncluded.disabled = !isPlanted;
    }
  }

  const isGrooved = bottomPlacement.value === "grooved";
  grooveFields.style.opacity = isGrooved ? "1" : "0.6";
  [grooveDepth, grooveHeight, grooveSides, grooveFront, grooveBack].forEach((field) => {
    if (field) {
      field.disabled = !isGrooved;
    }
  });

  updateDrawerConstructionReference();
}

function readCustomConstructionFromInputs() {
  return {
    constructionType: "custom",
    sideThickness: parseMeasurement(byId("newConstructionSideThk").value),
    frontBackThickness: parseMeasurement(byId("newConstructionFrontThk").value),
    bottomThickness: parseMeasurement(byId("newConstructionBottomThk").value),
    customFrontRipSign: byId("customFrontRipSign").value,
    customFrontRipOffset: parseMeasurement(byId("customFrontRipOffset").value),
    customBackRipSign: byId("customBackRipSign").value,
    customBackRipOffset: parseMeasurement(byId("customBackRipOffset").value),
    customSideRipSign: byId("customSideRipSign").value,
    customSideRipOffset: parseMeasurement(byId("customSideRipOffset").value),
    customFrontLenSign: byId("customFrontLenSign").value,
    customFrontLenOffset: parseMeasurement(byId("customFrontLenOffset").value),
    customBackLenSign: byId("customBackLenSign").value,
    customBackLenOffset: parseMeasurement(byId("customBackLenOffset").value),
    customSideLenSign: byId("customSideLenSign").value,
    customSideLenOffset: parseMeasurement(byId("customSideLenOffset").value),
    customBottomWidthBasis: byId("customBottomWidthBasis").value,
    customBottomWidthSign: byId("customBottomWidthSign").value,
    customBottomWidthOffset: parseMeasurement(byId("customBottomWidthOffset").value),
    customBottomLengthBasis: byId("customBottomLengthBasis").value,
    customBottomLengthSign: byId("customBottomLengthSign").value,
    customBottomLengthOffset: parseMeasurement(byId("customBottomLengthOffset").value)
  };
}

function renderCustomConfirmPreview() {
  const typeSelect = byId("newConstructionType");
  const body = byId("customConfirmBody");
  if (!typeSelect || typeSelect.value !== "custom" || !body) {
    return;
  }

  const construction = readCustomConstructionFromInputs();
  const sampleBox = { width: 12, height: 4, depth: 21 };
  const parts = drawerPartsForBox(sampleBox, construction, 1);
  body.innerHTML = "";

  parts.forEach((part) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${part.label}</td>
      <td>${fmt(part.width)}</td>
      <td>${fmt(part.length)}</td>
      <td>${fmt(part.thickness)}</td>
      <td>${part.qty}</td>
    `;
    body.appendChild(row);
  });
}

function showConstructionStep(step) {
  const steps = Array.from(document.querySelectorAll("#constructionWizard .wizard-step"));
  const prevBtn = byId("constructionPrevBtn");
  const nextBtn = byId("constructionNextBtn");
  const typeSelect = byId("newConstructionType");
  if (!steps.length || !prevBtn || !nextBtn) {
    return;
  }

  const maxStep = steps.length;
  let safeStep = Math.min(Math.max(step, 1), maxStep);
  if (typeSelect && typeSelect.value === "custom" && safeStep === 3) {
    safeStep = 4;
  }
  state.ui.constructionStep = safeStep;
  steps.forEach((item) => {
    item.classList.toggle("hidden", item.dataset.step !== String(safeStep));
  });

  prevBtn.disabled = safeStep === 1;
  nextBtn.textContent = safeStep === maxStep ? "Finish" : "Next";
  updateDrawerConstructionReference();
  if (typeSelect && typeSelect.value === "custom" && safeStep === 4) {
    renderCustomConfirmPreview();
  }
}

function handleConstructionNext() {
  const steps = Array.from(document.querySelectorAll("#constructionWizard .wizard-step"));
  const maxStep = steps.length;
  const typeSelect = byId("newConstructionType");
  if (state.ui.constructionStep >= maxStep) {
    const createBtn = byId("addConstructionBtn");
    if (createBtn) {
      createBtn.click();
    }
    return;
  }
  if (typeSelect && typeSelect.value === "custom" && state.ui.constructionStep === 2) {
    showConstructionStep(4);
    return;
  }
  showConstructionStep(state.ui.constructionStep + 1);
}

function handleConstructionPrev() {
  const typeSelect = byId("newConstructionType");
  if (typeSelect && typeSelect.value === "custom" && state.ui.constructionStep === 4) {
    showConstructionStep(2);
    return;
  }
  showConstructionStep(state.ui.constructionStep - 1);
}

function updateDrawerConstructionReference() {
  const typeSelect = byId("newConstructionType");
  const bottomPlacement = byId("newButtBottomPlacement");
  const sideRun = byId("newConstructionSideRun");
  const dovetailMode = byId("newDovetailMode");
  const dovetailFrontEnabled = byId("dovetailFrontSetbackEnabled");
  const dovetailBackEnabled = byId("dovetailBackSetbackEnabled");
  const image = byId("drawerConstructionImage");
  const caption = byId("drawerConstructionCaption");
  const title = byId("drawerConstructionTitle");
  if (!image || !caption || !typeSelect) {
    return;
  }

  const step = state.ui.constructionStep || 1;

  const type = typeSelect.value;
  if (step === 1) {
    let imageName = "ButtJoint Drawer.jpg";
    let captionText = "Butt joint drawer reference.";
    let titleText = "Butt Joint Reference";
    if (type === "lock") {
      imageName = "LockJoint Drawer.jpg";
      captionText = "Lock joint drawer reference.";
      titleText = "Lock Joint Reference";
    } else if (type === "dovetail") {
      imageName = "Dovetail Drawer Box.png";
      captionText = "Dovetail drawer reference.";
      titleText = "Dovetail Reference";
    } else if (type === "custom") {
      imageName = "ButtJoint Drawer.jpg";
      captionText = "Custom drawer reference (placeholder).";
      titleText = "Custom Reference";
    }

    image.src = assetUrl(imageName);
    image.alt = captionText;
    if (title) {
      title.textContent = titleText;
    }
    caption.textContent = captionText;
    return;
  }

  if (step === 2 && type === "lock") {
    const sideValue = sideRun ? sideRun.value : "length";
    image.src = assetUrl(sideValue === "length" ? "LJ Long Side Dado Depth.png" : "LJ Long Front Dado Depth(SQUARE).png");
    image.alt = "Lock joint drawer reference showing dado depth (Y) and material thickness (X).";
    if (title) {
      title.textContent = "Lock Joint Reference";
    }
    caption.textContent = "X = material thickness, Y = dado depth.";
    return;
  }

  if (step === 2 && type === "dovetail") {
    const mode = dovetailMode ? dovetailMode.value : "through";
    const frontOn = dovetailFrontEnabled ? dovetailFrontEnabled.checked : false;
    const backOn = dovetailBackEnabled ? dovetailBackEnabled.checked : false;
    if (mode === "setback") {
      image.src = assetUrl("Dovetail Side Set Back.png");
      image.alt = "Dovetail side setback reference.";
      if (title) {
        title.textContent = "Dovetail Setback";
      }
      if (frontOn && backOn) {
        caption.textContent = "Sides run long minus front and back setbacks (X).";
      } else if (frontOn) {
        caption.textContent = "Sides run long minus front setback (X).";
      } else if (backOn) {
        caption.textContent = "Sides run long minus back setback (X).";
      } else {
        caption.textContent = "Sides run long; add setbacks (X) for front/back if needed.";
      }
    } else {
      image.src = assetUrl("DT Side and Front Through.png");
      image.alt = "Dovetail side and front through reference.";
      if (title) {
        title.textContent = "Dovetail Through";
      }
      caption.textContent = "Side and front are through; box size matches part size.";
    }
    return;
  }

  if (step === 2 && type === "butt") {
    const sideValue = sideRun ? sideRun.value : "length";
    image.src = assetUrl(sideValue === "length" ? "ButtJoint Side Long.png" : "ButtJoint Side Short.png");
    image.alt = "Butt joint drawer reference showing which parts run long.";
    if (title) {
      title.textContent = "Butt Joint Reference";
    }
    caption.textContent = sideValue === "length"
      ? "Sides run long; front/back are between."
      : "Front/back run long; sides are between.";
    return;
  }

  const showGroove = step === 3 && bottomPlacement && bottomPlacement.value === "grooved";
  if (showGroove) {
    image.src = assetUrl("Bottom Groove Location and Depth(Square).png");
    image.alt = "Drawer bottom groove reference showing X for groove width, Y for groove height, Z for groove depth.";
    if (title) {
      title.textContent = "Bottom Groove Reference";
    }
    caption.textContent = "X = groove width, Y = groove height, Z = groove depth.";
    return;
  }

  if (step === 3 && bottomPlacement && bottomPlacement.value === "planted") {
    image.src = assetUrl("Plant-On Bottom.png");
    image.alt = "Drawer bottom planted on the bottom reference.";
    if (title) {
      title.textContent = "Plant-On Bottom Reference";
    }
    caption.textContent = "No grooves. Bottom is planted on the drawer bottom.";
    return;
  }

  if (step === 4) {
    image.src = assetUrl("Rear Drawer Bottom Dim.png");
    image.alt = "Drawer bottom sizing adjustments reference.";
    if (title) {
      title.textContent = "Drawer Bottom Sizing";
    }
    caption.textContent = "Bottom width/length adjustments applied to the rear panel.";
    return;
  }

  image.src = assetUrl("Bottom Groove Location and Depth(Square).png");
  image.alt = "Drawer construction reference.";
  if (title) {
    title.textContent = "Construction Reference";
  }
  caption.textContent = "Answer the current step to see the relevant reference image.";
}

async function saveSettings() {
  if (await ensureDataMode() === "api") {
    await apiJson("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.settings)
    });
  } else {
    saveLocalSettings(state.settings);
  }
}

async function loadProject() {
  const projectId = byId("projectSelect").value;
  if (!projectId) {
    return;
  }

  const project = state.projects.find((item) => item.id === projectId);
  if (!project) {
    return;
  }

  byId("projectName").value = project.name || "";

  const doorSizeTableBody = byId("doorSizeTableBody");
  if (doorSizeTableBody) {
    doorSizeTableBody.innerHTML = "";
  }
  const doorOpeningTableBody = byId("doorOpeningTableBody");
  if (doorOpeningTableBody) {
    doorOpeningTableBody.innerHTML = "";
  }
  const drawerOpeningTableBody = byId("drawerOpeningTableBody");
  if (drawerOpeningTableBody) {
    drawerOpeningTableBody.innerHTML = "";
  }
  const drawerBoxTableBody = byId("drawerBoxTableBody");
  if (drawerBoxTableBody) {
    drawerBoxTableBody.innerHTML = "";
  }

  (project.payload?.doors || []).forEach(addDoorRow);
  (project.payload?.openings || []).forEach(addOpeningRow);
  (project.payload?.drawerOpenings || []).forEach(addDrawerOpeningRow);
  (project.payload?.drawerBoxes || []).forEach(addDrawerBoxRow);

  const doorStyleSelect = byId("doorStyleSelect");
  if (doorStyleSelect && project.payload?.doorSizeStyleId) {
    doorStyleSelect.value = project.payload.doorSizeStyleId;
  }
  const doorOpeningStyleSelect = byId("doorOpeningStyleSelect");
  if (doorOpeningStyleSelect && project.payload?.doorOpeningStyleId) {
    doorOpeningStyleSelect.value = project.payload.doorOpeningStyleId;
  }
  const drawerOpeningSlideSelect = byId("drawerOpeningSlideSelect");
  if (drawerOpeningSlideSelect && project.payload?.drawerOpeningSlideId) {
    drawerOpeningSlideSelect.value = project.payload.drawerOpeningSlideId;
  }
  const drawerOpeningConstructionSelect = byId("drawerOpeningConstructionSelect");
  if (drawerOpeningConstructionSelect && project.payload?.drawerOpeningConstructionId) {
    drawerOpeningConstructionSelect.value = project.payload.drawerOpeningConstructionId;
  }
  const drawerBoxSlideSelect = byId("drawerBoxSlideSelect");
  if (drawerBoxSlideSelect && project.payload?.drawerBoxSlideId) {
    drawerBoxSlideSelect.value = project.payload.drawerBoxSlideId;
  }
  const drawerBoxConstructionSelect = byId("drawerBoxConstructionSelect");
  if (drawerBoxConstructionSelect && project.payload?.drawerBoxConstructionId) {
    drawerBoxConstructionSelect.value = project.payload.drawerBoxConstructionId;
  }

  state.ui.doorInputMode = project.payload?.doorInputMode || "size";
  state.ui.drawerInputMode = project.payload?.drawerInputMode || "opening";
  updateInputModeUi();
  renderInputSummaries();

  ensureDefaultRows();
  ensureDoorSizeRows();
  ensureDoorOpeningRows();
  ensureDrawerOpeningRows();
  ensureDrawerBoxRows();
}

async function deleteProject() {
  const projectId = byId("projectSelect").value;
  if (!projectId) {
    return;
  }

  if (await ensureDataMode() === "api") {
    await apiJson(`/api/projects/${projectId}`, { method: "DELETE" });
  } else {
    const projects = localProjects().filter((project) => project.id !== projectId);
    saveLocalProjects(projects);
  }

  byId("projectName").value = "";
  await loadCatalog();
  await refreshUi();
}

async function addCatalogItem({ listKey, payload, apiPath }) {
  if (await ensureDataMode() === "api") {
    await apiJson(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } else {
    const catalog = localCatalog();
    catalog[listKey] = [...catalog[listKey], { id: Math.random().toString(36).slice(2, 10), ...payload }];
    saveLocalCatalog(catalog);
  }

  await loadCatalog();
  await refreshUi();
}

async function deleteCatalogItem({ listKey, id, apiPath }) {
  if (await ensureDataMode() === "api") {
    await apiJson(`${apiPath}/${id}`, { method: "DELETE" });
  } else {
    const catalog = localCatalog();
    catalog[listKey] = catalog[listKey].filter((item) => item.id !== id);
    saveLocalCatalog(catalog);
  }

  await loadCatalog();
  await refreshUi();
}

async function updateCatalogItem({ listKey, id, payload, apiPath }) {
  if (await ensureDataMode() === "api") {
    await apiJson(`${apiPath}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } else {
    const catalog = localCatalog();
    catalog[listKey] = catalog[listKey].map((item) => (item.id === id ? { ...item, ...payload } : item));
    saveLocalCatalog(catalog);
  }

  await loadCatalog();
  await refreshUi();
}

async function editDoorStyle(id) {
  const style = state.catalog.doorStyles.find((item) => item.id === id);
  if (!style) {
    return;
  }

  const name = prompt("Style name", style.name);
  if (!name) {
    return;
  }

  const jointType = prompt("Joint type (copeStick or mitered)", style.jointType || "copeStick");
  if (!jointType) {
    return;
  }

  const stileWidth = prompt("Stile width (X)", formatMeasurement(style.stileWidth));
  if (stileWidth === null) {
    return;
  }
  const matchRailsToStiles = prompt("Match rails to stiles? (yes/no)", style.matchRailsToStiles ? "yes" : "no");
  if (matchRailsToStiles === null) {
    return;
  }
  const railWidth = prompt("Bottom rail width (X)", formatMeasurement(style.railWidth));
  if (railWidth === null) {
    return;
  }
  const matchRails = String(matchRailsToStiles).toLowerCase().startsWith("y");
  let customTopRail = "no";
  let topRailWidth = formatMeasurement(style.topRailWidth || style.railWidth);
  if (!matchRails) {
    customTopRail = prompt("Use custom top rail? (yes/no)", style.customTopRail ? "yes" : "no");
    if (customTopRail === null) {
      return;
    }
    topRailWidth = prompt("Top rail width (X)", formatMeasurement(style.topRailWidth || style.railWidth));
    if (topRailWidth === null) {
      return;
    }
  }
  const grooveDepth = prompt("Groove depth (Y)", formatMeasurement(style.grooveDepth || style.stickDepth || style.copeDepth));
  if (grooveDepth === null) {
    return;
  }
  const panelClearance = prompt("Panel clearance (Z)", formatMeasurement(style.panelClearance));
  if (panelClearance === null) {
    return;
  }
  const oversizeEnabled = prompt("Oversize doors? (yes/no)", style.oversizeEnabled ? "yes" : "no");
  if (oversizeEnabled === null) {
    return;
  }
  const oversizeAmount = prompt("Oversize amount", formatMeasurement(style.oversizeAmount || 0.125));
  if (oversizeAmount === null) {
    return;
  }

  const updates = {
    name: name.trim(),
    jointType: jointType === "mitered" ? "mitered" : "copeStick",
    stileWidth: parseMeasurement(stileWidth),
    railWidth: parseMeasurement(railWidth),
    grooveDepth: parseMeasurement(grooveDepth),
    copeDepth: parseMeasurement(grooveDepth),
    stickDepth: parseMeasurement(grooveDepth),
    panelClearance: parseMeasurement(panelClearance),
    matchRailsToStiles: matchRails,
    customTopRail: matchRails ? false : String(customTopRail).toLowerCase().startsWith("y"),
    topRailWidth: parseMeasurement(topRailWidth),
    oversizeEnabled: String(oversizeEnabled).toLowerCase().startsWith("y"),
    oversizeAmount: parseMeasurement(oversizeAmount)
  };

  if (updates.jointType === "mitered") {
    updates.matchRailsToStiles = true;
    updates.customTopRail = false;
  }

  if (updates.matchRailsToStiles) {
    updates.railWidth = updates.stileWidth;
  }

  if (!updates.customTopRail) {
    updates.topRailWidth = updates.railWidth;
  }

  if (!Number.isFinite(updates.stileWidth) || !Number.isFinite(updates.railWidth)) {
    alert("Enter valid numeric sizes.");
    return;
  }

  await updateCatalogItem({ listKey: "doorStyles", id, payload: updates, apiPath: "/api/door-styles" });
}

async function editOverlay(id) {
  const overlay = state.catalog.overlayTemplates.find((item) => item.id === id);
  if (!overlay) {
    return;
  }

  const name = prompt("Overlay name", overlay.name);
  if (!name) {
    return;
  }

  const left = prompt("Left overlay", formatMeasurement(overlay.left));
  if (left === null) {
    return;
  }
  const right = prompt("Right overlay", formatMeasurement(overlay.right));
  if (right === null) {
    return;
  }
  const top = prompt("Top overlay", formatMeasurement(overlay.top));
  if (top === null) {
    return;
  }
  const bottom = prompt("Bottom overlay", formatMeasurement(overlay.bottom));
  if (bottom === null) {
    return;
  }
  const gap = prompt("Door gap for pairs", formatMeasurement(overlay.gap));
  if (gap === null) {
    return;
  }

  const updates = {
    name: name.trim(),
    left: parseMeasurement(left),
    right: parseMeasurement(right),
    top: parseMeasurement(top),
    bottom: parseMeasurement(bottom),
    gap: parseMeasurement(gap)
  };

  if (!Number.isFinite(updates.left) || !Number.isFinite(updates.right)) {
    alert("Enter valid numeric sizes.");
    return;
  }

  await updateCatalogItem({ listKey: "overlayTemplates", id, payload: updates, apiPath: "/api/overlay-templates" });
}

async function editSlide(id) {
  const slide = state.catalog.drawerSlides.find((item) => item.id === id);
  if (!slide) {
    return;
  }

  const name = prompt("Slide name", slide.name);
  if (!name) {
    return;
  }

  const sideClearance = prompt("Side clearance", formatMeasurement(slide.sideClearance));
  if (sideClearance === null) {
    return;
  }
  const depthClearance = prompt("Depth clearance", formatMeasurement(slide.depthClearance));
  if (depthClearance === null) {
    return;
  }
  const topClearance = prompt("Top clearance", formatMeasurement(slide.topClearance));
  if (topClearance === null) {
    return;
  }
  const bottomClearance = prompt("Bottom clearance", formatMeasurement(slide.bottomClearance));
  if (bottomClearance === null) {
    return;
  }

  const updates = {
    name: name.trim(),
    sideClearance: parseMeasurement(sideClearance),
    depthClearance: parseMeasurement(depthClearance),
    topClearance: parseMeasurement(topClearance),
    bottomClearance: parseMeasurement(bottomClearance)
  };

  if (!Number.isFinite(updates.sideClearance) || !Number.isFinite(updates.depthClearance)) {
    alert("Enter valid numeric sizes.");
    return;
  }

  await updateCatalogItem({ listKey: "drawerSlides", id, payload: updates, apiPath: "/api/drawer-slides" });
}

async function editConstruction(id) {
  const construction = state.catalog.drawerConstructions.find((item) => item.id === id);
  if (!construction) {
    return;
  }

  const name = prompt("Construction name", construction.name);
  if (!name) {
    return;
  }

  const typePrompt = prompt("Construction type (butt, lock, dovetail, custom)", construction.constructionType || "butt");
  if (!typePrompt) {
    return;
  }
  const constructionType = typePrompt.trim();

  const sideThickness = prompt("Side thickness", formatMeasurement(construction.sideThickness));
  if (sideThickness === null) {
    return;
  }
  let frontBackThickness = construction.frontBackThickness;
  if (constructionType !== "lock") {
    const frontBackPrompt = prompt("Front/Back thickness", formatMeasurement(construction.frontBackThickness));
    if (frontBackPrompt === null) {
      return;
    }
    frontBackThickness = parseMeasurement(frontBackPrompt);
  } else {
    frontBackThickness = parseMeasurement(sideThickness);
  }
  const bottomThickness = prompt("Bottom thickness", formatMeasurement(construction.bottomThickness));
  if (bottomThickness === null) {
    return;
  }
  const bottomIncluded = prompt("Bottom thickness included in drawer height? (y/n)", construction.bottomThicknessIncluded ? "y" : "n");
  if (bottomIncluded === null) {
    return;
  }
  const bottomAdjustWidth = prompt("Bottom adjust width (total)", formatMeasurement(construction.bottomAdjustWidth));
  if (bottomAdjustWidth === null) {
    return;
  }
  const bottomAdjustLength = prompt("Bottom adjust length (total)", formatMeasurement(construction.bottomAdjustLength));
  if (bottomAdjustLength === null) {
    return;
  }

  let buttSideRun = construction.buttSideRun || "length";
  let buttBottomPlacement = construction.buttBottomPlacement || "grooved";
  let buttGrooveDepth = construction.buttGrooveDepth || 0;
  let buttGrooveHeight = construction.buttGrooveHeight || 0;
  let buttGrooveSides = construction.buttGrooveSides !== undefined ? construction.buttGrooveSides : true;
  let buttGrooveFront = construction.buttGrooveFront !== undefined ? construction.buttGrooveFront : true;
  let buttGrooveBack = construction.buttGrooveBack !== undefined ? construction.buttGrooveBack : false;
  let lockSideRun = construction.lockSideRun || "length";
  let lockDadoDepth = construction.lockDadoDepth || 0;
  let dovetailMode = construction.dovetailMode || "through";
  let dovetailFrontSetbackEnabled = construction.dovetailFrontSetbackEnabled || false;
  let dovetailBackSetbackEnabled = construction.dovetailBackSetbackEnabled || false;
  let dovetailFrontSetback = Number.isFinite(construction.dovetailFrontSetback) ? construction.dovetailFrontSetback : 0;
  let dovetailBackSetback = Number.isFinite(construction.dovetailBackSetback) ? construction.dovetailBackSetback : 0;
  let customFrontRipSign = construction.customFrontRipSign || "sub";
  let customFrontRipOffset = Number.isFinite(construction.customFrontRipOffset) ? construction.customFrontRipOffset : 0;
  let customBackRipSign = construction.customBackRipSign || "sub";
  let customBackRipOffset = Number.isFinite(construction.customBackRipOffset) ? construction.customBackRipOffset : 0;
  let customSideRipSign = construction.customSideRipSign || "sub";
  let customSideRipOffset = Number.isFinite(construction.customSideRipOffset) ? construction.customSideRipOffset : 0;
  let customFrontLenSign = construction.customFrontLenSign || "sub";
  let customFrontLenOffset = Number.isFinite(construction.customFrontLenOffset) ? construction.customFrontLenOffset : 0;
  let customBackLenSign = construction.customBackLenSign || "sub";
  let customBackLenOffset = Number.isFinite(construction.customBackLenOffset) ? construction.customBackLenOffset : 0;
  let customSideLenSign = construction.customSideLenSign || "sub";
  let customSideLenOffset = Number.isFinite(construction.customSideLenOffset) ? construction.customSideLenOffset : 0;
  let customBottomWidthBasis = construction.customBottomWidthBasis || "width";
  let customBottomWidthSign = construction.customBottomWidthSign || "sub";
  let customBottomWidthOffset = Number.isFinite(construction.customBottomWidthOffset) ? construction.customBottomWidthOffset : 0;
  let customBottomLengthBasis = construction.customBottomLengthBasis || "depth";
  let customBottomLengthSign = construction.customBottomLengthSign || "sub";
  let customBottomLengthOffset = Number.isFinite(construction.customBottomLengthOffset) ? construction.customBottomLengthOffset : 0;
  let bottomThicknessIncluded = bottomIncluded.trim().toLowerCase().startsWith("y");

  if (constructionType === "butt") {
    const sideRun = prompt("Butt joint - sides run (length/between)", buttSideRun);
    if (sideRun === null) {
      return;
    }
    buttSideRun = sideRun.trim();

    const bottomPlacement = prompt("Butt joint - bottom placement (grooved/planted)", buttBottomPlacement);
    if (bottomPlacement === null) {
      return;
    }
    buttBottomPlacement = bottomPlacement.trim();

    const grooveDepth = prompt("Butt joint - groove depth", formatMeasurement(buttGrooveDepth));
    if (grooveDepth === null) {
      return;
    }
    const grooveHeight = prompt("Butt joint - groove height from bottom", formatMeasurement(buttGrooveHeight));
    if (grooveHeight === null) {
      return;
    }
    buttGrooveDepth = parseMeasurement(grooveDepth);
    buttGrooveHeight = parseMeasurement(grooveHeight);

    const grooveSides = prompt("Butt joint - groove sides? (y/n)", buttGrooveSides ? "y" : "n");
    if (grooveSides === null) {
      return;
    }
    buttGrooveSides = grooveSides.trim().toLowerCase().startsWith("y");

    const grooveFront = prompt("Butt joint - groove front? (y/n)", buttGrooveFront ? "y" : "n");
    if (grooveFront === null) {
      return;
    }
    buttGrooveFront = grooveFront.trim().toLowerCase().startsWith("y");

    const grooveBack = prompt("Butt joint - groove back? (y/n)", buttGrooveBack ? "y" : "n");
    if (grooveBack === null) {
      return;
    }
    buttGrooveBack = grooveBack.trim().toLowerCase().startsWith("y");
  } else if (constructionType === "lock") {
    const sideRun = prompt("Lock joint - sides run (length/between)", lockSideRun);
    if (sideRun === null) {
      return;
    }
    lockSideRun = sideRun.trim();

    const dadoDepth = prompt("Lock joint - dado depth", formatMeasurement(lockDadoDepth));
    if (dadoDepth === null) {
      return;
    }
    lockDadoDepth = parseMeasurement(dadoDepth);
  } else if (constructionType === "dovetail") {
    const mode = prompt("Dovetail mode (through/setback)", dovetailMode);
    if (mode === null) {
      return;
    }
    dovetailMode = mode.trim();
    if (dovetailMode === "setback") {
      const frontEnabled = prompt("Dovetail - front setback? (y/n)", dovetailFrontSetbackEnabled ? "y" : "n");
      if (frontEnabled === null) {
        return;
      }
      dovetailFrontSetbackEnabled = frontEnabled.trim().toLowerCase().startsWith("y");
      const backEnabled = prompt("Dovetail - back setback? (y/n)", dovetailBackSetbackEnabled ? "y" : "n");
      if (backEnabled === null) {
        return;
      }
      dovetailBackSetbackEnabled = backEnabled.trim().toLowerCase().startsWith("y");

      if (dovetailFrontSetbackEnabled) {
        const frontSetback = prompt("Dovetail - front setback", formatMeasurement(dovetailFrontSetback));
        if (frontSetback === null) {
          return;
        }
        dovetailFrontSetback = parseMeasurement(frontSetback);
      } else {
        dovetailFrontSetback = 0;
      }

      if (dovetailBackSetbackEnabled) {
        const backSetback = prompt("Dovetail - back setback", formatMeasurement(dovetailBackSetback));
        if (backSetback === null) {
          return;
        }
        dovetailBackSetback = parseMeasurement(backSetback);
      } else {
        dovetailBackSetback = 0;
      }
    } else {
      dovetailFrontSetbackEnabled = false;
      dovetailBackSetbackEnabled = false;
      dovetailFrontSetback = 0;
      dovetailBackSetback = 0;
    }
  } else if (constructionType === "custom") {
    const frontRipSign = prompt("Custom - front rip sign (add/sub)", customFrontRipSign);
    if (frontRipSign === null) {
      return;
    }
    customFrontRipSign = frontRipSign.trim();
    const frontRipOffset = prompt("Custom - front rip offset", formatMeasurement(customFrontRipOffset));
    if (frontRipOffset === null) {
      return;
    }
    customFrontRipOffset = parseMeasurement(frontRipOffset);

    const backRipSign = prompt("Custom - back rip sign (add/sub)", customBackRipSign);
    if (backRipSign === null) {
      return;
    }
    customBackRipSign = backRipSign.trim();
    const backRipOffset = prompt("Custom - back rip offset", formatMeasurement(customBackRipOffset));
    if (backRipOffset === null) {
      return;
    }
    customBackRipOffset = parseMeasurement(backRipOffset);

    const sideRipSign = prompt("Custom - side rip sign (add/sub)", customSideRipSign);
    if (sideRipSign === null) {
      return;
    }
    customSideRipSign = sideRipSign.trim();
    const sideRipOffset = prompt("Custom - side rip offset", formatMeasurement(customSideRipOffset));
    if (sideRipOffset === null) {
      return;
    }
    customSideRipOffset = parseMeasurement(sideRipOffset);

    const frontLenSign = prompt("Custom - front length sign (add/sub)", customFrontLenSign);
    if (frontLenSign === null) {
      return;
    }
    customFrontLenSign = frontLenSign.trim();
    const frontLenOffset = prompt("Custom - front length offset", formatMeasurement(customFrontLenOffset));
    if (frontLenOffset === null) {
      return;
    }
    customFrontLenOffset = parseMeasurement(frontLenOffset);

    const backLenSign = prompt("Custom - back length sign (add/sub)", customBackLenSign);
    if (backLenSign === null) {
      return;
    }
    customBackLenSign = backLenSign.trim();
    const backLenOffset = prompt("Custom - back length offset", formatMeasurement(customBackLenOffset));
    if (backLenOffset === null) {
      return;
    }
    customBackLenOffset = parseMeasurement(backLenOffset);

    const sideLenSign = prompt("Custom - side length sign (add/sub)", customSideLenSign);
    if (sideLenSign === null) {
      return;
    }
    customSideLenSign = sideLenSign.trim();
    const sideLenOffset = prompt("Custom - side length offset", formatMeasurement(customSideLenOffset));
    if (sideLenOffset === null) {
      return;
    }
    customSideLenOffset = parseMeasurement(sideLenOffset);

    const bottomWidthBasis = prompt("Custom - bottom width basis (width/depth)", customBottomWidthBasis);
    if (bottomWidthBasis === null) {
      return;
    }
    customBottomWidthBasis = bottomWidthBasis.trim();
    const bottomWidthSign = prompt("Custom - bottom width sign (add/sub)", customBottomWidthSign);
    if (bottomWidthSign === null) {
      return;
    }
    customBottomWidthSign = bottomWidthSign.trim();
    const bottomWidthOffset = prompt("Custom - bottom width offset", formatMeasurement(customBottomWidthOffset));
    if (bottomWidthOffset === null) {
      return;
    }
    customBottomWidthOffset = parseMeasurement(bottomWidthOffset);

    const bottomLengthBasis = prompt("Custom - bottom length basis (width/depth)", customBottomLengthBasis);
    if (bottomLengthBasis === null) {
      return;
    }
    customBottomLengthBasis = bottomLengthBasis.trim();
    const bottomLengthSign = prompt("Custom - bottom length sign (add/sub)", customBottomLengthSign);
    if (bottomLengthSign === null) {
      return;
    }
    customBottomLengthSign = bottomLengthSign.trim();
    const bottomLengthOffset = prompt("Custom - bottom length offset", formatMeasurement(customBottomLengthOffset));
    if (bottomLengthOffset === null) {
      return;
    }
    customBottomLengthOffset = parseMeasurement(bottomLengthOffset);
  } else {
    lockSideRun = "length";
  }

  const updates = {
    name: name.trim(),
    constructionType,
    sideThickness: parseMeasurement(sideThickness),
    frontBackThickness,
    bottomThickness: parseMeasurement(bottomThickness),
    bottomThicknessIncluded,
    bottomAdjustWidth: parseMeasurement(bottomAdjustWidth),
    bottomAdjustLength: parseMeasurement(bottomAdjustLength),
    buttSideRun,
    buttBottomPlacement,
    buttGrooveDepth,
    buttGrooveHeight,
    buttGrooveSides,
    buttGrooveFront,
    buttGrooveBack,
    dovetailMode,
    dovetailFrontSetbackEnabled,
    dovetailBackSetbackEnabled,
    dovetailFrontSetback,
    dovetailBackSetback,
    customFrontRipSign,
    customFrontRipOffset,
    customBackRipSign,
    customBackRipOffset,
    customSideRipSign,
    customSideRipOffset,
    customFrontLenSign,
    customFrontLenOffset,
    customBackLenSign,
    customBackLenOffset,
    customSideLenSign,
    customSideLenOffset,
    customBottomWidthBasis,
    customBottomWidthSign,
    customBottomWidthOffset,
    customBottomLengthBasis,
    customBottomLengthSign,
    customBottomLengthOffset,
    lockSideRun,
    lockDadoDepth
  };

  if (!Number.isFinite(updates.sideThickness) || !Number.isFinite(updates.frontBackThickness)) {
    alert("Enter valid numeric sizes.");
    return;
  }

  await updateCatalogItem({ listKey: "drawerConstructions", id, payload: updates, apiPath: "/api/drawer-constructions" });
}

function renderDoorStyles() {
  const body = byId("doorStyleTableBody");
  body.innerHTML = "";

  state.catalog.doorStyles.forEach((style) => {
    const row = document.createElement("tr");
    const grooveDepth = Number.isFinite(style.grooveDepth)
      ? style.grooveDepth
      : Number.isFinite(style.stickDepth)
        ? style.stickDepth
        : style.copeDepth;
    const baseRailWidth = style.matchRailsToStiles ? style.stileWidth : style.railWidth;
    const topRailWidth = style.customTopRail && Number.isFinite(style.topRailWidth)
      ? style.topRailWidth
      : baseRailWidth;
    const oversizeLabel = style.oversizeEnabled ? formatMeasurement(style.oversizeAmount || 0) : "No";
    row.innerHTML = `
      <td>${style.name}</td>
      <td>${style.jointType}</td>
      <td>${fmt(style.stileWidth)}</td>
      <td>${fmt(baseRailWidth)}</td>
      <td>${fmt(topRailWidth)}</td>
      <td>${fmt(grooveDepth)}</td>
      <td>${fmt(style.panelClearance)}</td>
      <td>${oversizeLabel}</td>
      <td class="action-cell"></td>
    `;
    const actions = row.querySelector(".action-cell");
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editDoorStyle(style.id));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteCatalogItem({ listKey: "doorStyles", id: style.id, apiPath: "/api/door-styles" }));
    actions.append(editBtn, delBtn);
    body.appendChild(row);
  });
}

function renderOverlayTemplates() {
  const body = byId("overlayTableBody");
  body.innerHTML = "";

  state.catalog.overlayTemplates.forEach((overlay) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${overlay.name}</td>
      <td>${fmt(overlay.left)}</td>
      <td>${fmt(overlay.right)}</td>
      <td>${fmt(overlay.top)}</td>
      <td>${fmt(overlay.bottom)}</td>
      <td>${fmt(overlay.gap)}</td>
      <td class="action-cell"></td>
    `;
    const actions = row.querySelector(".action-cell");
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editOverlay(overlay.id));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteCatalogItem({ listKey: "overlayTemplates", id: overlay.id, apiPath: "/api/overlay-templates" }));
    actions.append(editBtn, delBtn);
    body.appendChild(row);
  });
}

function renderDrawerSlides() {
  const body = byId("slideTableBody");
  body.innerHTML = "";

  state.catalog.drawerSlides.forEach((slide) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${slide.name}</td>
      <td>${fmt(slide.sideClearance)}</td>
      <td>${fmt(slide.depthClearance)}</td>
      <td>${fmt(slide.topClearance)}</td>
      <td>${fmt(slide.bottomClearance)}</td>
      <td class="action-cell"></td>
    `;
    const actions = row.querySelector(".action-cell");
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editSlide(slide.id));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteCatalogItem({ listKey: "drawerSlides", id: slide.id, apiPath: "/api/drawer-slides" }));
    actions.append(editBtn, delBtn);
    body.appendChild(row);
  });
}

function renderDrawerConstructions() {
  const body = byId("constructionTableBody");
  body.innerHTML = "";

  state.catalog.drawerConstructions.forEach((construction) => {
    const row = document.createElement("tr");
    const grooveLabel = construction.constructionType === "butt" && construction.buttBottomPlacement === "grooved"
      ? `Sides:${construction.buttGrooveSides ? "Y" : "N"} Front:${construction.buttGrooveFront ? "Y" : "N"} Back:${construction.buttGrooveBack ? "Y" : "N"}`
      : construction.constructionType === "lock"
        ? `Sides:${construction.lockSideRun || "length"} Dado:${fmt(construction.lockDadoDepth || 0)}`
        : "-";
    const bottomAdjust = `${fmt(construction.bottomAdjustWidth)} / ${fmt(construction.bottomAdjustLength)}`;
    row.innerHTML = `
      <td>${construction.name}</td>
      <td>${construction.constructionType || "butt"}</td>
      <td>${fmt(construction.sideThickness)}</td>
      <td>${fmt(construction.frontBackThickness)}</td>
      <td>${fmt(construction.bottomThickness)}</td>
      <td>${bottomAdjust}</td>
      <td>${grooveLabel}</td>
      <td class="action-cell"></td>
    `;
    const actions = row.querySelector(".action-cell");
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => editConstruction(construction.id));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteCatalogItem({ listKey: "drawerConstructions", id: construction.id, apiPath: "/api/drawer-constructions" }));
    actions.append(editBtn, delBtn);
    body.appendChild(row);
  });
}

function wireTabs() {
  function setupTabGroup(group) {
    group.forEach(({ btn, panel }) => {
      byId(btn).addEventListener("click", () => {
        group.forEach(({ btn: otherBtn, panel: otherPanel }) => {
          byId(otherBtn).classList.remove("active");
          byId(otherPanel).classList.add("hidden");
        });
        byId(btn).classList.add("active");
        byId(panel).classList.remove("hidden");
      });
    });
  }

  setupTabGroup([
    { btn: "projectTabBtn", panel: "projectSection" },
    { btn: "settingsTabBtn", panel: "settingsSection" }
  ]);

  setupTabGroup([
    { btn: "doorSectionBtn", panel: "doorSection" },
    { btn: "drawerSectionBtn", panel: "drawerSection" }
  ]);

  setupTabGroup([
    { btn: "settingsDoorsBtn", panel: "settingsDoors" },
    { btn: "settingsDrawersBtn", panel: "settingsDrawers" }
  ]);

  setupTabGroup([
    { btn: "doorSetupTabBtn", panel: "doorSetupTab" },
    { btn: "overlaySetupTabBtn", panel: "overlaySetupTab" }
  ]);

  setupTabGroup([
    { btn: "drawerSlidesTabBtn", panel: "drawerSlidesTab" },
    { btn: "drawerConstructionTabBtn", panel: "drawerConstructionTab" }
  ]);
}

function wireButtons() {
  const addDoorRowsBtn = byId("addDoorRowsBtn");
  if (addDoorRowsBtn) {
    addDoorRowsBtn.addEventListener("click", () => {
      for (let i = 0; i < 5; i += 1) {
        addDoorSizeRow();
      }
    });
  }
  byId("addOpeningBtn").addEventListener("click", () => {
    for (let i = 0; i < 5; i += 1) {
      addOpeningRow();
    }
  });
  byId("addDrawerOpeningBtn").addEventListener("click", () => {
    for (let i = 0; i < 5; i += 1) {
      addDrawerOpeningRow();
    }
  });
  byId("addDrawerBoxBtn").addEventListener("click", () => {
    for (let i = 0; i < 5; i += 1) {
      addDrawerBoxRow();
    }
  });

  byId("calculateDoorsBtn").addEventListener("click", calculateDoorCutlist);
  byId("calculateDrawersBtn").addEventListener("click", calculateDrawerCutlist);

  byId("doorInputSizeBtn").addEventListener("click", () => {
    state.ui.doorInputMode = "size";
    updateInputModeUi();
    renderInputSummaries();
  });

  byId("doorInputOpeningBtn").addEventListener("click", () => {
    state.ui.doorInputMode = "opening";
    updateInputModeUi();
    renderInputSummaries();
  });

  byId("drawerInputOpeningBtn").addEventListener("click", () => {
    state.ui.drawerInputMode = "opening";
    updateInputModeUi();
    renderInputSummaries();
  });

  byId("drawerInputBoxBtn").addEventListener("click", () => {
    state.ui.drawerInputMode = "box";
    updateInputModeUi();
    renderInputSummaries();
  });

  byId("saveProjectBtn").addEventListener("click", saveProject);
  byId("loadProjectBtn").addEventListener("click", loadProject);
  byId("deleteProjectBtn").addEventListener("click", deleteProject);

  byId("addDoorStyleBtn").addEventListener("click", () => {
    const payload = {
      name: byId("newDoorStyleName").value.trim(),
      jointType: byId("newDoorJointType").value,
      stileWidth: parseMeasurement(byId("newDoorStileWidth").value),
      railWidth: parseMeasurement(byId("newDoorBottomRailWidth").value),
      grooveDepth: parseMeasurement(byId("newDoorGrooveDepth").value),
      copeDepth: parseMeasurement(byId("newDoorGrooveDepth").value),
      stickDepth: parseMeasurement(byId("newDoorGrooveDepth").value),
      panelClearance: parseMeasurement(byId("newDoorPanelClearance").value),
      matchRailsToStiles: byId("matchRailsToStiles").checked,
      customTopRail: !byId("matchRailsToStiles").checked,
      topRailWidth: parseMeasurement(byId("newDoorTopRailWidth").value),
      oversizeEnabled: byId("oversizeToggle").checked,
      oversizeAmount: parseMeasurement(byId("oversizeAmount").value)
    };

    if (!payload.name) {
      alert("Door style name is required.");
      return;
    }

    if (payload.jointType === "mitered") {
      payload.matchRailsToStiles = true;
      payload.customTopRail = false;
    }

    if (payload.matchRailsToStiles) {
      payload.railWidth = payload.stileWidth;
      payload.topRailWidth = payload.stileWidth;
    }

    if (!payload.customTopRail) {
      payload.topRailWidth = payload.railWidth;
    }

    addCatalogItem({ listKey: "doorStyles", payload, apiPath: "/api/door-styles" });
  });

  byId("addOverlayBtn").addEventListener("click", () => {
    const payload = {
      name: byId("newOverlayName").value.trim(),
      left: parseMeasurement(byId("newOverlayLeft").value),
      right: parseMeasurement(byId("newOverlayRight").value),
      top: parseMeasurement(byId("newOverlayTop").value),
      bottom: parseMeasurement(byId("newOverlayBottom").value),
      gap: parseMeasurement(byId("newOverlayGap").value)
    };

    if (!payload.name) {
      alert("Overlay name is required.");
      return;
    }

    addCatalogItem({ listKey: "overlayTemplates", payload, apiPath: "/api/overlay-templates" });
  });

  byId("addSlideBtn").addEventListener("click", () => {
    const payload = {
      name: byId("newSlideName").value.trim(),
      sideClearance: parseMeasurement(byId("newSlideSide").value),
      depthClearance: parseMeasurement(byId("newSlideDepth").value),
      topClearance: parseMeasurement(byId("newSlideTop").value),
      bottomClearance: parseMeasurement(byId("newSlideBottom").value)
    };

    if (!payload.name) {
      alert("Slide name is required.");
      return;
    }

    addCatalogItem({ listKey: "drawerSlides", payload, apiPath: "/api/drawer-slides" });
  });

  byId("addConstructionBtn").addEventListener("click", () => {
    const payload = {
      name: byId("newConstructionName").value.trim(),
      constructionType: byId("newConstructionType").value,
      sideThickness: parseMeasurement(byId("newConstructionSideThk").value),
      frontBackThickness: parseMeasurement(byId("newConstructionFrontThk").value),
      lockDadoDepth: parseMeasurement(byId("newLockDadoDepth").value),
      bottomThickness: parseMeasurement(byId("newConstructionBottomThk").value),
      bottomThicknessIncluded: byId("newBottomThicknessIncluded").checked,
      bottomAdjustWidth: parseMeasurement(byId("newConstructionBottomAdjustWidth").value),
      bottomAdjustLength: parseMeasurement(byId("newConstructionBottomAdjustLength").value),
      buttSideRun: byId("newConstructionSideRun").value,
      buttBottomPlacement: byId("newButtBottomPlacement").value,
      buttGrooveDepth: parseMeasurement(byId("newButtGrooveDepth").value),
      buttGrooveHeight: parseMeasurement(byId("newButtGrooveHeight").value),
      buttGrooveSides: byId("newButtGrooveSides").checked,
      buttGrooveFront: byId("newButtGrooveFront").checked,
      buttGrooveBack: byId("newButtGrooveBack").checked,
      dovetailMode: byId("newDovetailMode").value,
      dovetailFrontSetbackEnabled: byId("dovetailFrontSetbackEnabled").checked,
      dovetailBackSetbackEnabled: byId("dovetailBackSetbackEnabled").checked,
      dovetailFrontSetback: parseMeasurement(byId("newDovetailFrontSetback").value),
      dovetailBackSetback: parseMeasurement(byId("newDovetailBackSetback").value),
      customFrontRipSign: byId("customFrontRipSign").value,
      customFrontRipOffset: parseMeasurement(byId("customFrontRipOffset").value),
      customBackRipSign: byId("customBackRipSign").value,
      customBackRipOffset: parseMeasurement(byId("customBackRipOffset").value),
      customSideRipSign: byId("customSideRipSign").value,
      customSideRipOffset: parseMeasurement(byId("customSideRipOffset").value),
      customFrontLenSign: byId("customFrontLenSign").value,
      customFrontLenOffset: parseMeasurement(byId("customFrontLenOffset").value),
      customBackLenSign: byId("customBackLenSign").value,
      customBackLenOffset: parseMeasurement(byId("customBackLenOffset").value),
      customSideLenSign: byId("customSideLenSign").value,
      customSideLenOffset: parseMeasurement(byId("customSideLenOffset").value),
      customBottomWidthBasis: byId("customBottomWidthBasis").value,
      customBottomWidthSign: byId("customBottomWidthSign").value,
      customBottomWidthOffset: parseMeasurement(byId("customBottomWidthOffset").value),
      customBottomLengthBasis: byId("customBottomLengthBasis").value,
      customBottomLengthSign: byId("customBottomLengthSign").value,
      customBottomLengthOffset: parseMeasurement(byId("customBottomLengthOffset").value),
      lockSideRun: byId("newConstructionSideRun").value
    };

    if (!payload.name) {
      alert("Construction name is required.");
      return;
    }

    if (payload.constructionType !== "lock") {
      payload.lockSideRun = "length";
      payload.lockDadoDepth = 0;
    } else {
      payload.frontBackThickness = payload.sideThickness;
    }
    if (payload.constructionType !== "dovetail") {
      payload.dovetailMode = "through";
      payload.dovetailFrontSetbackEnabled = false;
      payload.dovetailBackSetbackEnabled = false;
      payload.dovetailFrontSetback = 0;
      payload.dovetailBackSetback = 0;
    } else if (payload.dovetailMode !== "setback") {
      payload.dovetailFrontSetbackEnabled = false;
      payload.dovetailBackSetbackEnabled = false;
      payload.dovetailFrontSetback = 0;
      payload.dovetailBackSetback = 0;
    } else {
      if (!payload.dovetailFrontSetbackEnabled) {
        payload.dovetailFrontSetback = 0;
      }
      if (!payload.dovetailBackSetbackEnabled) {
        payload.dovetailBackSetback = 0;
      }
    }
    if (payload.constructionType !== "custom") {
      payload.customFrontRipSign = "sub";
      payload.customFrontRipOffset = 0;
      payload.customBackRipSign = "sub";
      payload.customBackRipOffset = 0;
      payload.customSideRipSign = "sub";
      payload.customSideRipOffset = 0;
      payload.customFrontLenSign = "sub";
      payload.customFrontLenOffset = 0;
      payload.customBackLenSign = "sub";
      payload.customBackLenOffset = 0;
      payload.customSideLenSign = "sub";
      payload.customSideLenOffset = 0;
      payload.customBottomWidthBasis = "width";
      payload.customBottomWidthSign = "sub";
      payload.customBottomWidthOffset = 0;
      payload.customBottomLengthBasis = "depth";
      payload.customBottomLengthSign = "sub";
      payload.customBottomLengthOffset = 0;
    }
    if (!Number.isFinite(payload.customFrontRipOffset)) {
      payload.customFrontRipOffset = 0;
    }
    if (!Number.isFinite(payload.customBackRipOffset)) {
      payload.customBackRipOffset = 0;
    }
    if (!Number.isFinite(payload.customSideRipOffset)) {
      payload.customSideRipOffset = 0;
    }
    if (!Number.isFinite(payload.customFrontLenOffset)) {
      payload.customFrontLenOffset = 0;
    }
    if (!Number.isFinite(payload.customBackLenOffset)) {
      payload.customBackLenOffset = 0;
    }
    if (!Number.isFinite(payload.customSideLenOffset)) {
      payload.customSideLenOffset = 0;
    }
    if (!Number.isFinite(payload.customBottomWidthOffset)) {
      payload.customBottomWidthOffset = 0;
    }
    if (!Number.isFinite(payload.customBottomLengthOffset)) {
      payload.customBottomLengthOffset = 0;
    }
    if (!Number.isFinite(payload.dovetailFrontSetback)) {
      payload.dovetailFrontSetback = 0;
    }
    if (!Number.isFinite(payload.dovetailBackSetback)) {
      payload.dovetailBackSetback = 0;
    }

    addCatalogItem({ listKey: "drawerConstructions", payload, apiPath: "/api/drawer-constructions" });
  });

  byId("unitSystemSelect").addEventListener("change", async (event) => {
    state.settings.unitSystem = event.target.value === "metric" ? "metric" : "in";
    updateSettingsUi();
    updateUnitLabels();
    wireMeasurementInputs();
    formatAllMeasurementInputs();
    await saveSettings();
  });

  byId("precisionSelect").addEventListener("change", async (event) => {
    state.settings.precision = event.target.value;
    wireMeasurementInputs();
    formatAllMeasurementInputs();
    await saveSettings();
  });

  byId("matchRailsToStiles").addEventListener("change", (event) => {
    if (event.target.checked) {
      const stileValue = byId("newDoorStileWidth").value;
      byId("newDoorTopRailWidth").value = stileValue;
      byId("newDoorBottomRailWidth").value = stileValue;
    }
    updateRailInputsVisibility();
    formatAllMeasurementInputs();
  });

  byId("oversizeToggle").addEventListener("change", (event) => {
    byId("oversizeAmountWrap").style.display = event.target.checked ? "grid" : "none";
  });

  const doorSizeTableBody = byId("doorSizeTableBody");
  if (doorSizeTableBody) {
    doorSizeTableBody.addEventListener("input", renderInputSummaries);
  }
  const doorOpeningTableBody = byId("doorOpeningTableBody");
  if (doorOpeningTableBody) {
    doorOpeningTableBody.addEventListener("input", renderInputSummaries);
  }
  const drawerOpeningTableBody = byId("drawerOpeningTableBody");
  if (drawerOpeningTableBody) {
    drawerOpeningTableBody.addEventListener("input", renderInputSummaries);
  }
  const drawerBoxTableBody = byId("drawerBoxTableBody");
  if (drawerBoxTableBody) {
    drawerBoxTableBody.addEventListener("input", renderInputSummaries);
  }

  byId("newDoorJointType").addEventListener("change", updateRailInputsVisibility);

  const constructionType = byId("newConstructionType");
  if (constructionType) {
    constructionType.addEventListener("change", updateConstructionInputsVisibility);
  }
  const buttBottomPlacement = byId("newButtBottomPlacement");
  if (buttBottomPlacement) {
    buttBottomPlacement.addEventListener("change", updateConstructionInputsVisibility);
  }
  const sideRun = byId("newConstructionSideRun");
  if (sideRun) {
    sideRun.addEventListener("change", updateDrawerConstructionReference);
  }
  const dovetailMode = byId("newDovetailMode");
  if (dovetailMode) {
    dovetailMode.addEventListener("change", updateConstructionInputsVisibility);
  }
  const dovetailFrontEnabled = byId("dovetailFrontSetbackEnabled");
  if (dovetailFrontEnabled) {
    dovetailFrontEnabled.addEventListener("change", updateConstructionInputsVisibility);
  }
  const dovetailBackEnabled = byId("dovetailBackSetbackEnabled");
  if (dovetailBackEnabled) {
    dovetailBackEnabled.addEventListener("change", updateConstructionInputsVisibility);
  }

  const customInputs = document.querySelectorAll("#customSizingWrap select, #customSizingWrap input");
  if (customInputs.length) {
    customInputs.forEach((input) => {
      input.addEventListener("input", renderCustomConfirmPreview);
      input.addEventListener("change", renderCustomConfirmPreview);
    });
  }

  const constructionPrevBtn = byId("constructionPrevBtn");
  if (constructionPrevBtn) {
    constructionPrevBtn.addEventListener("click", handleConstructionPrev);
  }
  const constructionNextBtn = byId("constructionNextBtn");
  if (constructionNextBtn) {
    constructionNextBtn.addEventListener("click", handleConstructionNext);
  }

  const sideThk = byId("newConstructionSideThk");
  if (sideThk) {
    sideThk.addEventListener("input", () => {
      const typeSelect = byId("newConstructionType");
      const frontBackThk = byId("newConstructionFrontThk");
      if (typeSelect && frontBackThk && typeSelect.value === "lock") {
        frontBackThk.value = sideThk.value;
      }
    });
  }
}

async function init() {
  await loadCatalog();
  await refreshWelcomeBanner();
  wireTabs();
  wireButtons();
  await refreshUi();
  updateRailInputsVisibility();
  updateConstructionInputsVisibility();
  showConstructionStep(1);
  updateDrawerConstructionReference();
  byId("oversizeAmountWrap").style.display = "none";
}

init();
