import {
  SLOT_TYPE_LABELS,
  compatibleComponents,
  componentDisplayName,
  componentForSlot,
  createDefaultDesign,
  createIndexes,
  parseDesign,
  serializeDesign,
  setSlotComponent,
  summarizeDesign,
} from "./designer-core.js";

const state = {
  catalog: null,
  indexes: null,
  design: null,
  selectedSocketName: "",
  componentSearch: "",
  componentCategory: "all",
  viewMode: "top",
};

const els = {};

const VIEW_MODES = {
  top: {
    label: "X / Z",
    xAxis: "x",
    yAxis: "z",
    xSize: "x",
    ySize: "z",
    invertY: true,
    hullClass: "socket-map--top",
  },
  side: {
    label: "Z / Y",
    xAxis: "z",
    yAxis: "y",
    xSize: "z",
    ySize: "y",
    invertY: true,
    hullClass: "socket-map--side",
  },
  front: {
    label: "X / Y",
    xAxis: "x",
    yAxis: "y",
    xSize: "x",
    ySize: "y",
    invertY: true,
    hullClass: "socket-map--front",
  },
};

function $(selector) {
  return document.querySelector(selector);
}

function formatNumber(value, digits = 0) {
  return Number(value ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function sizeLabel(size) {
  if (!size) return "-";
  return `${size.x ?? 0}x${size.y ?? 0}x${size.z ?? 0}`;
}

function selectedHull() {
  return state.indexes.hullByName.get(state.design.hullName);
}

function selectedSocket() {
  const hull = selectedHull();
  return hull.sockets.find((socket) => socket.shortName === state.selectedSocketName) ?? hull.sockets[0];
}

function componentCategories(components) {
  return [...new Set(components.map((component) => component.category).filter(Boolean))].sort();
}

function activeViewMode() {
  return VIEW_MODES[state.viewMode] ?? VIEW_MODES.top;
}

function socketBounds(sockets, viewMode) {
  const xs = sockets.map((socket) => socket.position?.[viewMode.xAxis] ?? 0);
  const ys = sockets.map((socket) => socket.position?.[viewMode.yAxis] ?? 0);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function socketStyle(socket, bounds, viewMode) {
  const x = socket.position?.[viewMode.xAxis] ?? 0;
  const y = socket.position?.[viewMode.yAxis] ?? 0;
  const xRange = Math.max(bounds.maxX - bounds.minX, 1);
  const yRange = Math.max(bounds.maxY - bounds.minY, 1);
  const left = 8 + ((x - bounds.minX) / xRange) * 84;
  const yRatio = (y - bounds.minY) / yRange;
  const top = 8 + (viewMode.invertY ? 1 - yRatio : yRatio) * 84;
  const sx = Number(socket.size?.[viewMode.xSize] ?? 2);
  const sy = Number(socket.size?.[viewMode.ySize] ?? 2);
  const width = Math.max(18, Math.min(58, 12 + sx * 4));
  const height = Math.max(18, Math.min(58, 12 + sy * 4));
  return `left:${left}%;top:${top}%;width:${width}px;height:${height}px`;
}

function renderHullSelector() {
  els.hullList.innerHTML = "";
  for (const hull of state.indexes.hulls) {
    const button = document.createElement("button");
    button.className = `hull-row ${hull.name === state.design.hullName ? "is-active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="hull-row__main">${hull.name}</span>
      <span class="hull-row__meta">${hull.hullClassification} | ${formatNumber(hull.pointCost)} pts</span>
    `;
    button.addEventListener("click", () => {
      state.design = createDefaultDesign(hull, state.indexes);
      state.selectedSocketName = hull.sockets[0]?.shortName ?? "";
      render();
    });
    els.hullList.append(button);
  }
}

function renderHeader(summary) {
  const { hull } = summary;
  els.hullName.textContent = hull.name;
  els.hullMeta.textContent = `${hull.hullClassification} | ${hull.factionKey} | ${formatNumber(hull.mass)} t`;
}

function renderSocketMap() {
  const hull = selectedHull();
  const viewMode = activeViewMode();
  const bounds = socketBounds(hull.sockets, viewMode);
  els.socketMap.innerHTML = "";
  els.socketMap.className = `socket-map ${viewMode.hullClass}`;
  els.viewAxisLabel.textContent = viewMode.label;
  for (const socket of hull.sockets) {
    const installed = componentForSlot(state.design, socket, state.indexes);
    const button = document.createElement("button");
    button.className = [
      "socket-node",
      `socket-node--${socket.typeName}`,
      socket.shortName === state.selectedSocketName ? "is-selected" : "",
      installed ? "is-filled" : "",
    ].join(" ");
    button.type = "button";
    button.style.cssText = socketStyle(socket, bounds, viewMode);
    button.title = `${socket.shortName} ${SLOT_TYPE_LABELS[socket.typeName] ?? socket.typeName} ${viewMode.label}`;
    button.innerHTML = `
      <span>${socket.shortName}</span>
      <small>${installed ? installed.name : ""}</small>
    `;
    button.addEventListener("click", () => {
      state.selectedSocketName = socket.shortName;
      render();
    });
    els.socketMap.append(button);
  }
}

function renderSocketDetails() {
  const socket = selectedSocket();
  const installed = componentForSlot(state.design, socket, state.indexes);
  els.socketTitle.textContent = `${socket.shortName} | ${socket.name}`;
  els.socketMeta.textContent = `${SLOT_TYPE_LABELS[socket.typeName] ?? socket.typeName} | ${sizeLabel(socket.size)} | pos ${formatNumber(socket.position?.x, 2)}, ${formatNumber(socket.position?.y, 2)}, ${formatNumber(socket.position?.z, 2)}`;
  els.installedName.textContent = componentDisplayName(installed?.name);
  els.installedMeta.textContent = installed
    ? `${installed.category} | ${formatNumber(installed.pointCost)} pts | ${formatNumber(installed.mass, 1)} t`
    : "No component installed";
  els.clearSlot.disabled = !installed;
}

function renderStats(summary) {
  const stats = [
    ["Points", formatNumber(summary.totals.pointCost)],
    ["Mass", formatNumber(summary.totals.mass, 1)],
    ["Crew req.", formatNumber(summary.totals.crewRequired)],
    ["Crew base", formatNumber(summary.totals.crewComplement)],
    ["Power", formatNumber(summary.totals.powerBalance)],
    ["Installed", `${summary.totals.installedCount}/${summary.totals.socketCount}`],
  ];
  els.statsGrid.innerHTML = "";
  for (const [label, value] of stats) {
    const item = document.createElement("div");
    item.className = "stat";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.statsGrid.append(item);
  }

  els.warningList.innerHTML = "";
  if (!summary.warnings.length) {
    const item = document.createElement("li");
    item.className = "warning warning--ok";
    item.textContent = "No warnings";
    els.warningList.append(item);
    return;
  }
  for (const warning of summary.warnings) {
    const item = document.createElement("li");
    item.className = "warning";
    item.textContent = warning;
    els.warningList.append(item);
  }
}

function renderComponentFilters() {
  const categories = componentCategories(state.indexes.components);
  if (els.categoryFilter.children.length) return;
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All categories";
  els.categoryFilter.append(all);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.categoryFilter.append(option);
  }
}

function renderComponentList() {
  const socket = selectedSocket();
  const installed = componentForSlot(state.design, socket, state.indexes);
  const search = state.componentSearch.trim().toLowerCase();
  const compatible = compatibleComponents(socket, state.indexes.components).filter((component) => {
    const matchesSearch =
      !search ||
      component.name.toLowerCase().includes(search) ||
      String(component.category ?? "").toLowerCase().includes(search);
    const matchesCategory =
      state.componentCategory === "all" || component.category === state.componentCategory;
    return matchesSearch && matchesCategory;
  });

  els.componentCount.textContent = `${compatible.length} compatible`;
  els.componentList.innerHTML = "";
  for (const component of compatible) {
    const button = document.createElement("button");
    button.className = `component-row ${installed?.name === component.name ? "is-installed" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="component-row__name">${component.name}</span>
      <span class="component-row__meta">${component.category} | ${sizeLabel(component.size)} | ${formatNumber(component.pointCost)} pts</span>
      <span class="component-row__meta">${formatNumber(component.mass, 1)} t | HP ${formatNumber(component.maxHealth)}</span>
    `;
    button.addEventListener("click", () => {
      state.design = setSlotComponent(state.design, socket, component);
      render();
    });
    els.componentList.append(button);
  }
}

function renderDesignJson() {
  els.designJson.value = serializeDesign(state.design);
}

function render() {
  if (!state.catalog) return;
  const summary = summarizeDesign(state.design, state.indexes);
  renderHeader(summary);
  renderHullSelector();
  renderSocketMap();
  renderSocketDetails();
  renderStats(summary);
  renderComponentFilters();
  renderComponentList();
  renderDesignJson();
  renderViewToolbar();
}

function bindElements() {
  Object.assign(els, {
    hullList: $("#hull-list"),
    hullName: $("#hull-name"),
    hullMeta: $("#hull-meta"),
    socketMap: $("#socket-map"),
    viewButtons: [...document.querySelectorAll("[data-view-mode]")],
    viewAxisLabel: $("#view-axis-label"),
    socketTitle: $("#socket-title"),
    socketMeta: $("#socket-meta"),
    installedName: $("#installed-name"),
    installedMeta: $("#installed-meta"),
    clearSlot: $("#clear-slot"),
    statsGrid: $("#stats-grid"),
    warningList: $("#warning-list"),
    componentSearch: $("#component-search"),
    categoryFilter: $("#category-filter"),
    componentCount: $("#component-count"),
    componentList: $("#component-list"),
    designJson: $("#design-json"),
    loadDesign: $("#load-design"),
    resetDefaults: $("#reset-defaults"),
    saveLocal: $("#save-local"),
    loadLocal: $("#load-local"),
    status: $("#status"),
  });
}

function renderViewToolbar() {
  for (const button of els.viewButtons) {
    button.classList.toggle("is-active", button.dataset.viewMode === state.viewMode);
  }
}

function showStatus(message) {
  els.status.textContent = message;
  window.setTimeout(() => {
    if (els.status.textContent === message) els.status.textContent = "";
  }, 2500);
}

function bindEvents() {
  els.clearSlot.addEventListener("click", () => {
    state.design = setSlotComponent(state.design, selectedSocket(), null);
    render();
  });
  els.componentSearch.addEventListener("input", (event) => {
    state.componentSearch = event.target.value;
    renderComponentList();
  });
  els.categoryFilter.addEventListener("change", (event) => {
    state.componentCategory = event.target.value;
    renderComponentList();
  });
  els.resetDefaults.addEventListener("click", () => {
    state.design = createDefaultDesign(selectedHull(), state.indexes);
    render();
  });
  els.loadDesign.addEventListener("click", () => {
    try {
      state.design = parseDesign(els.designJson.value, state.indexes);
      state.selectedSocketName = selectedHull().sockets[0]?.shortName ?? "";
      render();
      showStatus("Design loaded");
    } catch (error) {
      showStatus(error.message);
    }
  });
  els.saveLocal.addEventListener("click", () => {
    localStorage.setItem("nebul-designer:last-design", serializeDesign(state.design));
    showStatus("Saved locally");
  });
  els.loadLocal.addEventListener("click", () => {
    const saved = localStorage.getItem("nebul-designer:last-design");
    if (!saved) {
      showStatus("No local design");
      return;
    }
    try {
      state.design = parseDesign(saved, state.indexes);
      render();
      showStatus("Loaded local design");
    } catch (error) {
      showStatus(error.message);
    }
  });
  for (const button of els.viewButtons) {
    button.addEventListener("click", () => {
      state.viewMode = button.dataset.viewMode;
      render();
    });
  }
}

async function loadCatalog() {
  const response = await fetch("../data/generated/catalog.json");
  if (!response.ok) throw new Error(`Catalog load failed: ${response.status}`);
  return response.json();
}

async function main() {
  bindElements();
  bindEvents();
  try {
    state.catalog = await loadCatalog();
    state.indexes = createIndexes(state.catalog);
    const keystone = state.indexes.hullByName.get("Keystone Destroyer") ?? state.indexes.hulls[0];
    state.design = createDefaultDesign(keystone, state.indexes);
    state.selectedSocketName = keystone.sockets[0]?.shortName ?? "";
    render();
  } catch (error) {
    $("#app-error").textContent = error.message;
  }
}

main();
