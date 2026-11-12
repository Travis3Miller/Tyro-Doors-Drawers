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
