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

const FACTION_GROUPS = [
  { key: "Stock/Alliance", label: "ANS", name: "Alliance Navy" },
  { key: "Stock/Protectorate", label: "OSP", name: "Outer Systems Protectorate" },
];
const GAMEPLAY_MODIFIER_LABELS = new Map([
  ["hull-maxspeed", "Max speed"],
  ["hull-turnrate", "Turn rate"],
  ["hull-linearmotor", "Linear motor"],
  ["hull-angularmotor", "Angular motor"],
  ["hull-sigpower-wake", "Wake signature"],
  ["hull-sigmult-radar", "Radar signature"],
  ["hull-missilechannels", "Missile channels"],
]);

function factionLabel(factionKey) {
  return FACTION_GROUPS.find((group) => group.key === factionKey)?.label ?? factionKey ?? "Other";
}

function $(selector) {
  return document.querySelector(selector);
}

function formatNumber(value, digits = 0) {
  return Number(value ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

function formatSignedNumber(value, digits = 0) {
  const number = Number(value ?? 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatNumber(number, digits)}`;
}

function formatSignedPercent(value, digits = 1) {
  return `${formatSignedNumber(Number(value ?? 0) * 100, digits)}%`;
}

function formatCurrentStat(stat, digits = 0) {
  const modifier = Number(stat?.modifier ?? 0);
  const suffix = Math.abs(modifier) > 0.0001 ? ` ${formatSignedPercent(modifier)}` : "";
  return `${formatNumber(stat?.value, digits)}${suffix}`;
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

function projectedBoxEdges(box, viewMode) {
  const center = box?.center;
  const extent = box?.extent;
  if (!center || !extent) return [];
  return [
    {
      x: Number(center[viewMode.xAxis] ?? 0) - Number(extent[viewMode.xAxis] ?? 0),
      y: Number(center[viewMode.yAxis] ?? 0) - Number(extent[viewMode.yAxis] ?? 0),
    },
    {
      x: Number(center[viewMode.xAxis] ?? 0) + Number(extent[viewMode.xAxis] ?? 0),
      y: Number(center[viewMode.yAxis] ?? 0) + Number(extent[viewMode.yAxis] ?? 0),
    },
  ];
}

function selectVolumeBox(hull) {
  const selectVolume = hull.geometry?.selectVolume;
  if (!selectVolume?.center || !selectVolume?.size) return null;
  return {
    center: selectVolume.center,
    extent: {
      x: Number(selectVolume.size.x ?? 0) / 2,
      y: Number(selectVolume.size.y ?? 0) / 2,
      z: Number(selectVolume.size.z ?? 0) / 2,
    },
  };
}

function socketBounds(hull, viewMode) {
  const points = [];
  for (const socket of hull.sockets ?? []) {
    points.push({
      x: socket.position?.[viewMode.xAxis] ?? 0,
      y: socket.position?.[viewMode.yAxis] ?? 0,
    });
  }
  for (const volume of hull.geometry?.volumes ?? []) {
    points.push(...projectedBoxEdges(volume, viewMode));
  }
  points.push(...projectedBoxEdges(selectVolumeBox(hull), viewMode));
  points.push(...projectedBoxEdges(hull.geometry?.radarSignature, viewMode));
  if (!points.length) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  }
  const xs = points.map((point) => Number(point.x ?? 0));
  const ys = points.map((point) => Number(point.y ?? 0));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function projectToMap(x, y, bounds, viewMode) {
  const xRange = Math.max(bounds.maxX - bounds.minX, 1);
  const yRange = Math.max(bounds.maxY - bounds.minY, 1);
  const left = 8 + ((x - bounds.minX) / xRange) * 84;
  const yRatio = (y - bounds.minY) / yRange;
  const top = 8 + (viewMode.invertY ? 1 - yRatio : yRatio) * 84;
  return { left, top };
}

function socketStyle(socket, bounds, viewMode) {
  const x = socket.position?.[viewMode.xAxis] ?? 0;
  const y = socket.position?.[viewMode.yAxis] ?? 0;
  const { left, top } = projectToMap(x, y, bounds, viewMode);
  const sx = Number(socket.size?.[viewMode.xSize] ?? 2);
  const sy = Number(socket.size?.[viewMode.ySize] ?? 2);
  const width = Math.max(18, Math.min(58, 12 + sx * 4));
  const height = Math.max(18, Math.min(58, 12 + sy * 4));
  return `left:${left}%;top:${top}%;width:${width}px;height:${height}px`;
}

function projectedBoxStyle(box, bounds, viewMode) {
  const edges = projectedBoxEdges(box, viewMode);
  if (edges.length !== 2) return "";
  const a = projectToMap(edges[0].x, edges[0].y, bounds, viewMode);
  const b = projectToMap(edges[1].x, edges[1].y, bounds, viewMode);
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const width = Math.max(2, Math.abs(a.left - b.left));
  const height = Math.max(2, Math.abs(a.top - b.top));
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
}

function renderHullSelector() {
  els.hullList.innerHTML = "";
  const orderedGroups = [
    ...FACTION_GROUPS,
    ...[...new Set(state.indexes.hulls.map((hull) => hull.factionKey))]
      .filter((key) => !FACTION_GROUPS.some((group) => group.key === key))
      .map((key) => ({ key, label: factionLabel(key), name: key || "Unassigned" })),
  ];

  for (const group of orderedGroups) {
    const hulls = state.indexes.hulls.filter((hull) => hull.factionKey === group.key);
    if (!hulls.length) continue;
    const section = document.createElement("section");
    section.className = "hull-group";
    const heading = document.createElement("div");
    heading.className = "hull-group__heading";
    heading.innerHTML = `
      <span>${group.label}</span>
      <small>${hulls.length} hulls</small>
    `;
    section.append(heading);

    for (const hull of hulls) {
      const button = document.createElement("button");
      button.className = `hull-row ${hull.name === state.design.hullName ? "is-active" : ""}`;
      button.type = "button";
      button.innerHTML = `
        <span class="hull-row__main">${hull.name}</span>
        <span class="hull-row__meta">${hull.hullClassification} | ${formatNumber(hull.pointCost)} pts${hull.modular ? " | modular" : ""}</span>
      `;
      button.addEventListener("click", () => {
        state.design = createDefaultDesign(hull, state.indexes);
        state.selectedSocketName = hull.sockets[0]?.shortName ?? "";
        state.componentSearch = "";
        state.componentCategory = "all";
        render();
        showStatus(`${hull.name} selected`);
      });
      section.append(button);
    }
    els.hullList.append(section);
  }
}

function renderHeader(summary) {
  const { hull } = summary;
  els.hullName.textContent = hull.name;
  els.hullMeta.textContent = `${factionLabel(hull.factionKey)} | ${hull.hullClassification} | ${formatNumber(hull.mass)} t${hull.modular ? " | representative modular layout" : ""}`;
  const stats = [
    ["Points", formatNumber(summary.totals.pointCost)],
    ["Power", formatNumber(summary.totals.powerBalance)],
    ["Speed", formatCurrentStat(summary.mobility.maxSpeed, 2)],
    ["Turn", formatCurrentStat(summary.mobility.turnRate, 3)],
  ];
  els.headerStats.innerHTML = "";
  for (const [label, value] of stats) {
    const chip = document.createElement("div");
    chip.className = "header-stat";
    chip.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.headerStats.append(chip);
  }
}

function renderSocketMap() {
  const hull = selectedHull();
  const viewMode = activeViewMode();
  const bounds = socketBounds(hull, viewMode);
  els.socketMap.innerHTML = "";
  els.socketMap.className = `socket-map ${viewMode.hullClass}`;
  els.viewAxisLabel.textContent = viewMode.label;
  renderHullGeometry(hull, bounds, viewMode);
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
      state.componentSearch = "";
      state.componentCategory = "all";
      render();
    });
    els.socketMap.append(button);
  }
}

function renderHullGeometry(hull, bounds, viewMode) {
  const outerBox = selectVolumeBox(hull);
  if (outerBox) {
    const outer = document.createElement("div");
    outer.className = "hull-volume hull-volume--outer";
    outer.style.cssText = projectedBoxStyle(outerBox, bounds, viewMode);
    els.socketMap.append(outer);
  }

  for (const volume of hull.geometry?.volumes ?? []) {
    const shape = document.createElement("div");
    shape.className = "hull-volume";
    shape.style.cssText = projectedBoxStyle(volume, bounds, viewMode);
    els.socketMap.append(shape);
  }
}

function renderSocketDetails() {
  const socket = selectedSocket();
  const installed = componentForSlot(state.design, socket, state.indexes);
  els.socketTitle.textContent = `${socket.shortName} | ${socket.name}`;
  const source = socket.sourcePart ? ` | ${socket.sourcePart}` : "";
  els.socketMeta.textContent = `${SLOT_TYPE_LABELS[socket.typeName] ?? socket.typeName} | ${sizeLabel(socket.size)} | pos ${formatNumber(socket.position?.x, 2)}, ${formatNumber(socket.position?.y, 2)}, ${formatNumber(socket.position?.z, 2)}${source}`;
  els.installedName.textContent = componentDisplayName(installed?.name);
  els.installedMeta.textContent = installed
    ? `${installed.category} | ${formatNumber(installed.pointCost)} pts | ${formatNumber(installed.mass, 1)} t`
    : "No component installed";
  els.clearSlot.disabled = !installed;
}

function renderSocketList() {
  const hull = selectedHull();
  els.socketList.innerHTML = "";
  for (const typeName of ["mount", "compartment", "module"]) {
    const sockets = hull.sockets.filter((socket) => socket.typeName === typeName);
    if (!sockets.length) continue;
    const group = document.createElement("div");
    group.className = "socket-list__group";
    const title = document.createElement("div");
    title.className = "socket-list__title";
    title.textContent = SLOT_TYPE_LABELS[typeName] ?? typeName;
    group.append(title);

    const rows = document.createElement("div");
    rows.className = "socket-list__rows";
    for (const socket of sockets) {
      const installed = componentForSlot(state.design, socket, state.indexes);
      const button = document.createElement("button");
      button.className = [
        "socket-list__item",
        `socket-list__item--${socket.typeName}`,
        socket.shortName === state.selectedSocketName ? "is-selected" : "",
        installed ? "is-filled" : "",
      ].join(" ");
      button.type = "button";
      button.innerHTML = `<span>${socket.shortName}</span><small>${installed ? componentDisplayName(installed.name) : sizeLabel(socket.size)}</small>`;
      button.addEventListener("click", () => {
        state.selectedSocketName = socket.shortName;
        state.componentSearch = "";
        state.componentCategory = "all";
        render();
      });
      rows.append(button);
    }
    group.append(rows);
    els.socketList.append(group);
  }
}

function renderStats(summary) {
  const stats = [
    ["Points", formatNumber(summary.totals.pointCost)],
    ["Mass", formatNumber(summary.totals.mass, 1)],
    ["Power", formatNumber(summary.totals.powerBalance)],
    ["Crew", `${formatNumber(summary.totals.crewRequired)}/${formatNumber(summary.totals.crewComplement)}`],
    ["Speed", formatCurrentStat(summary.mobility.maxSpeed, 2)],
    ["Turn", formatCurrentStat(summary.mobility.turnRate, 3)],
    ["Accel idx", formatNumber(summary.mobility.accelerationIndex * 1000, 2)],
    ["Turn idx", formatNumber(summary.mobility.turnIndex * 1000, 2)],
    ["Drives", `${summary.mobility.driveCount} / ${formatNumber(summary.mobility.drivePower)}`],
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
  const socket = selectedSocket();
  const hull = selectedHull();
  const compatible = compatibleComponents(socket, state.indexes.components, hull);
  const categories = componentCategories(compatible);
  const selected = state.componentCategory;
  els.categoryFilter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All compatible";
  els.categoryFilter.append(all);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.categoryFilter.append(option);
  }
  state.componentCategory = selected === "all" || categories.includes(selected) ? selected : "all";
  els.categoryFilter.value = state.componentCategory;
}

function componentEffectLabel(component) {
  const effects = (component.modifiers ?? [])
    .filter((modifier) => GAMEPLAY_MODIFIER_LABELS.has(modifier.statName))
    .map((modifier) => {
      const label = GAMEPLAY_MODIFIER_LABELS.get(modifier.statName);
      const percent = Math.abs(Number(modifier.modifier ?? 0)) > 0.0001
        ? formatSignedPercent(modifier.modifier)
        : "";
      const literal = Math.abs(Number(modifier.literal ?? 0)) > 0.0001
        ? formatSignedNumber(modifier.literal, 1)
        : "";
      return `${label} ${percent || literal}`.trim();
    });
  return effects.slice(0, 3).join(" | ");
}

function renderComponentList() {
  const socket = selectedSocket();
  const installed = componentForSlot(state.design, socket, state.indexes);
  const hull = selectedHull();
  const search = state.componentSearch.trim().toLowerCase();
  const equipmentFaction = hull.overrideEquipmentFactionKey || hull.factionKey || "Common";
  els.partsTitle.textContent = `${socket.shortName} | ${socket.name}`;
  els.partsMeta.textContent = `${SLOT_TYPE_LABELS[socket.typeName] ?? socket.typeName} | ${sizeLabel(socket.size)} | ${factionLabel(equipmentFaction)}`;
  els.componentSearch.value = state.componentSearch;
  els.categoryFilter.value = state.componentCategory;
  const compatible = compatibleComponents(socket, state.indexes.components, hull).filter((component) => {
    const matchesSearch =
      !search ||
      component.name.toLowerCase().includes(search) ||
      String(component.category ?? "").toLowerCase().includes(search);
    const matchesCategory =
      state.componentCategory === "all" || component.category === state.componentCategory;
    return matchesSearch && matchesCategory;
  });

  els.componentCount.textContent = `${compatible.length} selectable for ${socket.shortName}`;
  els.componentList.innerHTML = "";
  for (const component of compatible) {
    const button = document.createElement("button");
    button.className = `component-row ${installed?.name === component.name ? "is-installed" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="component-row__name">${component.name}</span>
      <span class="component-row__meta">${component.category} | ${sizeLabel(component.size)} | ${formatNumber(component.pointCost)} pts</span>
      <span class="component-row__meta">${componentEffectLabel(component) || `${formatNumber(component.mass, 1)} t | HP ${formatNumber(component.maxHealth)}`}</span>
    `;
    button.addEventListener("click", () => {
      state.design = setSlotComponent(state.design, socket, component);
      render();
      showStatus(`${component.name} installed in ${socket.shortName}`);
    });
    els.componentList.append(button);
  }
  if (!compatible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No compatible components for this socket.";
    els.componentList.append(empty);
  }
}

function socketSummaryLabel(hull) {
  return Object.entries(hull.socketSummary ?? {})
    .map(([key, value]) => `${key} ${value}`)
    .join(" / ");
}

function scalarSpecRows(summary) {
  const { hull } = summary;
  const structure = hull.structure ?? {};
  const armor = hull.armorAspect ?? {};
  return [
    ["Faction", hull.factionKey],
    ["Equipment", hull.overrideEquipmentFactionKey || hull.factionKey],
    ["Class", `${hull.className} ${hull.hullClassification ? `(${hull.hullClassification})` : ""}`],
    ["Layout", hull.modular ? "Representative modular bow/core/stern" : "Fixed hull"],
    ["Point total", `${formatNumber(summary.totals.pointCost)} (${formatNumber(hull.pointCost)} hull)`],
    ["Mass total", `${formatNumber(summary.totals.mass, 1)} t`],
    ["Crew", `${formatNumber(summary.totals.crewRequired)} required / ${formatNumber(summary.totals.crewComplement)} base`],
    ["Power balance", formatNumber(summary.totals.powerBalance)],
    ["Current max speed", formatCurrentStat(summary.mobility.maxSpeed, 2)],
    ["Current turn rate", formatCurrentStat(summary.mobility.turnRate, 3)],
    ["Linear motor force", formatCurrentStat(summary.mobility.linearMotor, 1)],
    ["Angular motor force", formatCurrentStat(summary.mobility.angularMotor, 1)],
    ["Acceleration index", formatNumber(summary.mobility.accelerationIndex * 1000, 2)],
    ["Turn index", formatNumber(summary.mobility.turnIndex * 1000, 2)],
    ["Drive output", `${summary.mobility.driveCount} drives / ${formatNumber(summary.mobility.drivePower)} power`],
    ["Drive names", summary.mobility.driveNames.join(" / ")],
    ["Base integrity", formatNumber(structure.baseIntegrity, 1)],
    ["Component DR", formatNumber(hull.componentDamageReduction, 3)],
    ["Interior armor eq.", formatNumber(hull.interiorDensityArmorEquivalent, 3)],
    ["Wake signature", formatCurrentStat(summary.mobility.wakeSignature, 1)],
    ["Fuel capacity", formatNumber(hull.fuelUnitCapacity, 1)],
    ["Storage transfer", formatNumber(hull.storageTransferRate, 3)],
    ["Craft repair slots", formatNumber(hull.baseCraftRepairSlots)],
    ["Sockets", socketSummaryLabel(hull)],
    ["Armor front angle", formatNumber(armor.FrontAngle, 1)],
    ["Armor rear angle", formatNumber(armor.RearAngle, 1)],
    ["Armor top angle", formatNumber(armor.TopAngle, 1)],
    ["Armor front mult", formatNumber(armor.FrontArmorMult, 3)],
    ["Armor side mult", formatNumber(armor.SideArmorMult, 3)],
    ["Armor rear mult", formatNumber(armor.RearArmorMult, 3)],
    ["Armor top mult", formatNumber(armor.TopArmorMult, 3)],
  ];
}

function gameplayModifierRows(modifiers) {
  const totals = new Map();
  for (const modifier of modifiers ?? []) {
    if (!GAMEPLAY_MODIFIER_LABELS.has(modifier.statName)) continue;
    const row = totals.get(modifier.statName) ?? { literal: 0, modifier: 0 };
    row.literal += Number(modifier.literal ?? 0);
    row.modifier += Number(modifier.modifier ?? 0);
    totals.set(modifier.statName, row);
  }
  return [...totals.entries()]
    .filter(([, value]) => Math.abs(value.literal) > 0.0001 || Math.abs(value.modifier) > 0.0001)
    .map(([statName, value]) => {
      const parts = [];
      if (Math.abs(value.modifier) > 0.0001) parts.push(formatSignedPercent(value.modifier));
      if (Math.abs(value.literal) > 0.0001) parts.push(formatSignedNumber(value.literal, 1));
      return [`Active ${GAMEPLAY_MODIFIER_LABELS.get(statName)}`, parts.join(" / ")];
    });
}

function renderHullSpecs(summary) {
  els.hullSpecs.innerHTML = "";
  for (const [label, value] of scalarSpecRows(summary)) {
    const row = document.createElement("div");
    row.className = "spec-row";
    row.innerHTML = `<span>${label}</span><strong>${value ?? "-"}</strong>`;
    els.hullSpecs.append(row);
  }
  for (const [label, value] of gameplayModifierRows(summary.mobility.modifiers)) {
    const row = document.createElement("div");
    row.className = "spec-row spec-row--modifier";
    row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    els.hullSpecs.append(row);
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
  renderSocketList();
  renderStats(summary);
  renderHullSpecs(summary);
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
    headerStats: $("#header-stats"),
    socketMap: $("#socket-map"),
    viewButtons: [...document.querySelectorAll("[data-view-mode]")],
    viewAxisLabel: $("#view-axis-label"),
    socketTitle: $("#socket-title"),
    socketMeta: $("#socket-meta"),
    socketList: $("#socket-list"),
    installedName: $("#installed-name"),
    installedMeta: $("#installed-meta"),
    clearSlot: $("#clear-slot"),
    statsGrid: $("#stats-grid"),
    hullSpecs: $("#hull-specs"),
    warningList: $("#warning-list"),
    componentSearch: $("#component-search"),
    categoryFilter: $("#category-filter"),
    componentCount: $("#component-count"),
    componentList: $("#component-list"),
    partsTitle: $("#parts-title"),
    partsMeta: $("#parts-meta"),
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
