const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function frontend() {
  const elements = {};
  function select() {
    return {
      options: [],
      value: "",
      set innerHTML(_value) { this.options = []; this.value = ""; },
      appendChild(option) {
        this.options.push(option);
        if (option.selected || this.options.length === 1) this.value = option.value;
      }
    };
  }
  for (const id of ["doorStyleSelect", "doorOpeningStyleSelect", "drawerOpeningSlideSelect",
    "drawerOpeningConstructionSelect", "drawerBoxSlideSelect", "drawerBoxConstructionSelect"]) {
    elements[id] = select();
  }
  const context = vm.createContext({
    window: { CUTLISTER_CONFIG: {} },
    document: {
      getElementById: (id) => elements[id],
      createElement: () => ({})
    },
    localStorage: { getItem: () => null, setItem: () => { throw new Error("unexpected local save"); } },
    Headers, URLSearchParams, console
  });
  const source = fs.readFileSync(path.join(__dirname, "../script.js"), "utf8").replace(/\ninit\(\);\s*$/, "\n");
  vm.runInContext(source, context);
  return { context, elements };
}

test("refreshing selections keeps the custom door style and its cutlist measurements", () => {
  const { context, elements } = frontend();
  vm.runInContext(`
    state.catalog = defaultCatalog();
    state.catalog.doorStyles.push({
      id: "custom", name: "Custom", stileWidth: 4, railWidth: 4,
      grooveDepth: 0.25, panelClearance: 0.125
    });
    populateDoorStyleSelects();
    populateDrawerInputSelects();
  `, context);
  elements.doorStyleSelect.value = "custom";
  elements.doorOpeningStyleSelect.value = "custom";
  elements.drawerOpeningSlideSelect.value = elements.drawerOpeningSlideSelect.options.at(-1).value;
  const slideId = elements.drawerOpeningSlideSelect.value;
  vm.runInContext(`
    populateDoorStyleSelects();
    populateDrawerInputSelects();
    readDoorRows = () => [{ width: 20, height: 30, qty: 1 }];
    renderDoorResults = () => {};
    calculateDoorCutlist();
  `, context);
  assert.equal(elements.doorStyleSelect.value, "custom");
  assert.equal(elements.doorOpeningStyleSelect.value, "custom");
  assert.equal(elements.drawerOpeningSlideSelect.value, slideId);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.doorList[0].styleName", context), "Custom");
  assert.equal(vm.runInContext("state.ui.lastDoorResults.stileRailParts.find(p => p.label === 'Rail').length", context), 12.5);
});

test("unavailable server cannot silently save projects locally", async () => {
  const { context, elements } = frontend();
  elements.projectName = { value: "Project" };
  elements.projectSelect = { value: "" };
  vm.runInContext(`
    state.dataMode = "local";
    apiFetch = async () => { throw new Error("offline"); };
    readDoorRows = readOpeningRows = readDrawerOpeningRows = readDrawerBoxRows = () => [];
    showAppMessage = (title, message) => { globalThis.message = { title, message }; };
  `, context);
  await vm.runInContext("saveProject()", context);
  assert.equal(context.message.title, "Not saved");
  assert.match(context.message.message, /not saved to your account/i);
});

test("saved grooved butt construction raises ungrooved back and keeps grooved parts full height", () => {
  const { context } = frontend();
  vm.runInContext(`
    const saved = defaultCatalog().drawerConstructions[0];
    state.catalog = normalizeCatalog({ drawerConstructions: [saved] });
    state.ui.drawerInputMode = "box";
    readDrawerBoxRows = () => [{ constructionId: saved.id, boxWidth: 12, boxHeight: 4, boxDepth: 21, qty: 1 }];
    renderDrawerResults = (results) => { globalThis.drawerResults = results; };
    calculateDrawerCutlist();
  `, context);
  const getPart = (name) => context.drawerResults.parts.find((part) => part.label === name);
  assert.equal(getPart("Drawer Front").width, 4);
  assert.equal(getPart("Drawer Side").width, 4);
  assert.equal(getPart("Drawer Back").width, 3.5);
  assert.equal(getPart("Drawer Back").qty, 1);
  assert.equal(getPart("Drawer Bottom").length, 20.1875);

  vm.runInContext(`
    state.catalog.drawerConstructions[0].buttGrooveBack = true;
    state.catalog.drawerConstructions[0].buttGrooveFront = false;
    state.catalog.drawerConstructions[0].buttGrooveSides = false;
    calculateDrawerCutlist();
  `, context);
  assert.equal(getPart("Drawer Back").width, 4);
  assert.equal(getPart("Drawer Front").width, 3.5);
  assert.equal(getPart("Drawer Side").width, 3.5);
  assert.equal(getPart("Drawer Bottom").length, 20.1875);
});

test("a missing custom style cannot be calculated with default measurements", () => {
  const { context, elements } = frontend();
  vm.runInContext(`
    state.catalog = defaultCatalog();
    populateDoorStyleSelects();
    showAppMessage = (title, message) => { globalThis.message = { title, message }; };
  `, context);
  elements.doorStyleSelect.value = "missing";
  vm.runInContext("populateDoorStyleSelects(); calculateDoorCutlist();", context);
  assert.equal(context.message.title, "Door style unavailable");
  assert.equal(elements.doorStyleSelect.value, "missing");
});

test("mitered cutlists use full frame lengths and clearance on each panel edge", () => {
  const { context } = frontend();
  const parts = JSON.parse(vm.runInContext(`JSON.stringify(doorPartsForSize({
    width: 10, height: 10, qty: 1,
    style: { jointType: "mitered", stileWidth: 2.5, railWidth: 1,
      grooveDepth: 0.5, panelClearance: 0.0625 }
  }))`, context));
  assert.deepEqual(parts, [
    { label: "Stile", length: 10, width: 2.5, qty: 2 },
    { label: "Rail", length: 10, width: 2.5, qty: 2 },
    { label: "Panel", length: 5.875, width: 5.875, qty: 1 }
  ]);
  const oversizeParts = JSON.parse(vm.runInContext(`JSON.stringify(doorPartsForSize({
    width: 12, height: 20, qty: 2,
    style: { jointType: "mitered", stileWidth: 2.5, grooveDepth: 0.5,
      panelClearance: 0.0625, oversizeEnabled: true, oversizeAmount: 0.125 }
  }))`, context));
  assert.deepEqual(oversizeParts, [
    { label: "Stile", length: 20.125, width: 2.5625, qty: 4 },
    { label: "Rail", length: 12.125, width: 2.5625, qty: 4 },
    { label: "Panel", length: 15.875, width: 7.875, qty: 2 }
  ]);
});

test("cope-and-stick cutlists use the selected saved style for door sizes and openings", () => {
  const { context, elements } = frontend();
  vm.runInContext(`
    state.catalog = defaultCatalog();
    state.catalog.doorStyles.push(
      { id: "two", name: "Two inch", jointType: "copeStick", stileWidth: 2, railWidth: 2,
        grooveDepth: 0.5, panelClearance: 0.0625, matchRailsToStiles: true },
      { id: "three", name: "Three inch", jointType: "copeStick", stileWidth: 3, railWidth: 3,
        grooveDepth: 0.5, panelClearance: 0.0625, matchRailsToStiles: true }
    );
    state.catalog.overlayTemplates = [{ id: "none", name: "No overlay", left: 0, right: 0, top: 0, bottom: 0, gap: 0 }];
    populateDoorStyleSelects();
    readDoorRows = () => [{ width: 10, height: 10, qty: 1 }];
    readOpeningRows = () => [{ openingWidth: 10, openingHeight: 10, doorCount: 1, overlayId: "none" }];
    renderDoorResults = () => {};
  `, context);
  elements.doorStyleSelect.value = "two";
  vm.runInContext("calculateDoorCutlist()", context);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.stileRailParts.find(p => p.label === 'Rail').length", context), 7);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.panelParts[0].width", context), 6.875);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.panelParts[0].length", context), 6.875);

  elements.doorStyleSelect.value = "three";
  vm.runInContext("calculateDoorCutlist()", context);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.stileRailParts.find(p => p.label === 'Rail').length", context), 5);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.panelParts[0].width", context), 4.875);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.panelParts[0].length", context), 4.875);

  elements.doorOpeningStyleSelect.value = "two";
  vm.runInContext('state.ui.doorInputMode = "opening"; calculateDoorCutlist()', context);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.stileRailParts.find(p => p.label === 'Rail').length", context), 7);
  assert.equal(vm.runInContext("state.ui.lastDoorResults.panelParts[0].width", context), 6.875);
});

test("cope-and-stick oversize adds half to each frame width without changing panel or rail lengths", () => {
  const { context } = frontend();
  const parts = JSON.parse(vm.runInContext(`JSON.stringify(doorPartsForSize({
    width: 10, height: 20, qty: 1,
    style: { jointType: "copeStick", stileWidth: 2.25, railWidth: 2,
      customTopRail: true, topRailWidth: 3, grooveDepth: 0.5, panelClearance: 0.0625,
      oversizeEnabled: true, oversizeAmount: 0.125 }
  }))`, context));
  assert.deepEqual(parts, [
    { label: "Stile", length: 20.125, width: 2.3125, qty: 2 },
    { label: "Bottom Rail", length: 6.5, width: 2.0625, qty: 1 },
    { label: "Top Rail", length: 6.5, width: 3.0625, qty: 1 },
    { label: "Panel", length: 15.875, width: 6.375, qty: 1 }
  ]);
  const withoutOversize = JSON.parse(vm.runInContext(`JSON.stringify(doorPartsForSize({
    width: 10, height: 20, qty: 1,
    style: { jointType: "copeStick", stileWidth: 2.25, railWidth: 2,
      customTopRail: true, topRailWidth: 3, grooveDepth: 0.5, panelClearance: 0.0625,
      oversizeEnabled: false, oversizeAmount: 0.125 }
  }))`, context));
  assert.deepEqual(withoutOversize[3], parts[3]);
  assert.equal(withoutOversize[1].length, parts[1].length);
});

test("cope-and-stick groove depth and clearance independently change the parts", () => {
  const { context } = frontend();
  const parts = JSON.parse(vm.runInContext(`JSON.stringify(doorPartsForSize({
    width: 10, height: 12, qty: 1,
    style: { jointType: "copeStick", stileWidth: 2, railWidth: 3,
      grooveDepth: 0.25, panelClearance: 0.125 }
  }))`, context));
  assert.deepEqual(parts, [
    { label: "Stile", length: 12, width: 2, qty: 2 },
    { label: "Rail", length: 6.5, width: 3, qty: 2 },
    { label: "Panel", length: 6.25, width: 6.25, qty: 1 }
  ]);
});

test("door style editor saves selected joint and dependent measurements", async () => {
  const { context, elements } = frontend();
  for (const id of ["editDoorName", "editDoorJointType", "editDoorStileWidth", "editDoorMatch",
    "editDoorRailWidth", "editDoorTopRailWidth", "editDoorGrooveDepth", "editDoorPanelClearance",
    "editDoorOversize", "editDoorOversizeAmount", "editDoorStyleError", "editDoorStyleSave"]) {
    elements[id] = { value: "", textContent: "", disabled: false };
  }
  for (const id of ["editDoorMatchWrap", "editDoorRailsWrap", "editDoorOversizeWrap"]) {
    elements[id] = { classList: { toggle(_name, hidden) { this.hidden = hidden; } } };
  }
  elements.editDoorStyleDialog = {
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  vm.runInContext(`
    state.catalog = defaultCatalog();
    state.catalog.doorStyles[0].grooveDepth = 0;
    state.catalog.doorStyles[0].oversizeAmount = 0;
    updateCatalogItem = async (item) => { globalThis.savedItem = item; return true; };
    editDoorStyle("default-shaker");
  `, context);
  assert.equal(elements.editDoorGrooveDepth.value, "0");
  assert.equal(elements.editDoorOversizeAmount.value, "0");
  elements.editDoorJointType.value = "mitered";
  elements.editDoorStileWidth.value = "2-1/2";
  elements.editDoorGrooveDepth.value = "1/2";
  elements.editDoorPanelClearance.value = "1/16";
  elements.editDoorMatch.value = "no";
  elements.editDoorOversize.value = "yes";
  elements.editDoorOversizeAmount.value = "1/8";
  vm.runInContext("updateEditDoorStyleVisibility()", context);
  assert.equal(elements.editDoorMatchWrap.classList.hidden, true);
  assert.equal(elements.editDoorRailsWrap.classList.hidden, true);
  assert.equal(elements.editDoorOversizeWrap.classList.hidden, false);
  await vm.runInContext("saveEditedDoorStyle({ preventDefault() {} })", context);
  assert.equal(context.savedItem.payload.jointType, "mitered");
  assert.equal(context.savedItem.payload.railWidth, 2.5);
  assert.equal(context.savedItem.payload.topRailWidth, 2.5);
  assert.equal(context.savedItem.payload.grooveDepth, 0.5);
  assert.equal(context.savedItem.payload.panelClearance, 0.0625);
  assert.equal(context.savedItem.payload.oversizeAmount, 0.125);
  assert.equal(elements.editDoorStyleDialog.open, false);

  vm.runInContext('editDoorStyle("default-shaker")', context);
  elements.editDoorJointType.value = "copeStick";
  elements.editDoorMatch.value = "no";
  elements.editDoorRailWidth.value = "3";
  elements.editDoorTopRailWidth.value = "4";
  vm.runInContext("updateEditDoorStyleVisibility()", context);
  assert.equal(elements.editDoorMatchWrap.classList.hidden, false);
  assert.equal(elements.editDoorRailsWrap.classList.hidden, false);
  await vm.runInContext("saveEditedDoorStyle({ preventDefault() {} })", context);
  assert.equal(context.savedItem.payload.railWidth, 3);
  assert.equal(context.savedItem.payload.topRailWidth, 4);
  assert.equal(context.savedItem.payload.customTopRail, true);

  vm.runInContext('editDoorStyle("default-shaker"); globalThis.savedItem = null;', context);
  elements.editDoorStileWidth.value = "bad";
  await vm.runInContext("saveEditedDoorStyle({ preventDefault() {} })", context);
  assert.equal(context.savedItem, null);
  assert.match(elements.editDoorStyleError.textContent, /valid/);
  assert.equal(elements.editDoorStyleDialog.open, true);
});

function constructionEditor() {
  const { context, elements } = frontend();
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    const listeners = {};
    elements[match[1]] = {
      value: "", checked: false, disabled: false, textContent: "", listeners,
      classList: { toggle(_name, hidden) { this.hidden = hidden; } },
      addEventListener(event, callback) { listeners[event] = callback; },
      showModal() { this.open = true; },
      close() { this.open = false; }
    };
  }
  context.document.querySelectorAll = () => [];
  vm.runInContext(`
    state.catalog = defaultCatalog();
    globalThis.calls = [];
    globalThis.saveResult = true;
    updateCatalogItem = async (item) => { calls.push(item); return saveResult; };
    wireButtons();
  `, context);
  return { context, elements, open: (id) => vm.runInContext(`editConstruction("${id}")`, context),
    save: () => elements.editConstructionForm.listeners.submit({ preventDefault() {} }) };
}

test("construction editor displays relevant fields and preserves hidden values when changing type", async () => {
  const { context, elements: e, open, save } = constructionEditor();
  vm.runInContext(`
    Object.assign(state.catalog.drawerConstructions[0], {
      customFrontRipOffset: 0.123456789, dovetailFrontSetback: 0.375,
      bottomInset: 0.3125
    });
  `, context);
  open("construct-butt");
  assert.equal(e.editConstructionButt.classList.hidden, false);
  assert.equal(e.editConstructionGroove.classList.hidden, false);
  assert.equal(e.editConstructionLock.classList.hidden, true);
  e.editConstructionButtBottomPlacement.value = "planted";
  e.editConstructionButtBottomPlacement.listeners.change();
  assert.equal(e.editConstructionGroove.classList.hidden, true);
  assert.equal(e.editConstructionIncludedWrap.classList.hidden, false);
  e.editConstructionButtGrooveDepth.value = "invalid";
  await save();
  assert.equal("buttGrooveDepth" in context.calls[0].payload, false);
  assert.equal("customFrontRipOffset" in context.calls[0].payload, false);

  open("construct-butt");
  e.editConstructionType.value = "lock";
  e.editConstructionType.listeners.change();
  assert.equal(e.editConstructionLock.classList.hidden, false);
  assert.equal(e.editConstructionAdjust.classList.hidden, true);
  assert.equal(e.editConstructionFrontBackWrap.classList.hidden, true);
  assert.equal(e.editConstructionBottomInset.value, "0.3125");
  e.editConstructionSideThickness.value = "3/4";
  e.editConstructionBottomInset.value = "1/8";
  await save();
  assert.equal(context.calls[1].payload.frontBackThickness, 0.75);
  assert.equal(context.calls[1].payload.bottomInset, 0.125);
  assert.equal("bottomAdjustWidth" in context.calls[1].payload, false);

  open("construct-dovetail");
  e.editConstructionDovetailMode.value = "setback";
  e.editConstructionDovetailMode.listeners.change();
  assert.equal(e.editConstructionDovetail.classList.hidden, false);
  assert.equal(e.editConstructionSetbacks.classList.hidden, false);
  assert.equal(e.editConstructionFrontSetbackWrap.classList.hidden, true);
  e.editConstructionDovetailFrontSetbackEnabled.checked = true;
  e.editConstructionDovetailFrontSetbackEnabled.listeners.change();
  e.editConstructionDovetailFrontSetback.value = "1/4";
  assert.equal(e.editConstructionFrontSetbackWrap.classList.hidden, false);
  await save();
  assert.equal(context.calls[2].payload.dovetailFrontSetback, 0.25);
  assert.equal("dovetailBackSetback" in context.calls[2].payload, false);
});

test("custom construction round trips precise formulas and produces the same parts", async () => {
  const { context, elements: e, open, save } = constructionEditor();
  vm.runInContext(`
    const item = state.catalog.drawerConstructions.find(item => item.id === "construct-custom");
    ["FrontRip", "BackRip", "SideRip", "FrontLen", "BackLen", "SideLen", "BottomWidth", "BottomLength"].forEach((field, index) => {
      item["custom" + field + "Sign"] = index % 2 ? "add" : "sub";
      item["custom" + field + "Offset"] = (index === 0 ? -1 : index + 1) / 1000;
    });
    item.customBottomWidthBasis = "depth";
    item.customBottomLengthBasis = "width";
    globalThis.beforeParts = JSON.stringify(drawerPartsForBox({ width: 12, height: 4, depth: 21 }, item, 1));
  `, context);
  open("construct-custom");
  assert.equal(e.editConstructionCustom.classList.hidden, false);
  assert.equal(e.editConstructionAdjust.classList.hidden, true);
  assert.equal(e.editConstructionCustomFrontRipOffset.value, "-0.001");
  await save();
  vm.runInContext(`
    const original = state.catalog.drawerConstructions.find(item => item.id === "construct-custom");
    globalThis.afterParts = JSON.stringify(drawerPartsForBox({ width: 12, height: 4, depth: 21 }, { ...original, ...calls[0].payload }, 1));
  `, context);
  assert.equal(context.beforeParts, context.afterParts);
  assert.equal(context.calls[0].payload.customBottomWidthBasis, "depth");
  assert.equal(context.calls[0].payload.customBottomLengthOffset, 0.008);
  assert.equal(e.editConstructionDialog.open, false);
});

test("construction editor validates active measurements, cancels and remains open on failed save", async () => {
  const { context, elements: e, open, save } = constructionEditor();
  open("construct-custom");
  for (const invalid of ["", "1/0", "1/2/3", "1--2", "1--2/3", "Infinity"]) {
    e.editConstructionCustomBottomLengthOffset.value = invalid;
    await save();
    assert.equal(context.calls.length, 0, invalid);
    assert.match(e.editConstructionError.textContent, /valid/);
  }
  e.editConstructionCustomBottomLengthOffset.value = "1 1/8";
  e.editConstructionBottomThickness.value = "0";
  await save();
  assert.equal(context.calls.length, 0);
  e.editConstructionBottomThickness.value = "1/4";
  vm.runInContext("saveResult = false", context);
  await save();
  assert.equal(context.calls[0].payload.customBottomLengthOffset, 1.125);
  assert.equal(e.editConstructionDialog.open, true);
  assert.equal(e.editConstructionSave.disabled, false);
  e.editConstructionCancel.listeners.click();
  assert.equal(e.editConstructionDialog.open, false);
  assert.equal(context.calls.length, 1);
});
