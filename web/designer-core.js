export const SLOT_TYPE_LABELS = {
  mount: "Mount",
  compartment: "Compartment",
  module: "Module",
};

export const NON_EDITOR_HULL_NAMES = new Set([
  "Mercator Oiler",
  "Worden Fleet Carrier",
]);

const SIZE_AXES = ["x", "y", "z"];
const MOBILITY_STATS = {
  maxSpeed: "hull-maxspeed",
  turnRate: "hull-turnrate",
  linearMotor: "hull-linearmotor",
  angularMotor: "hull-angularmotor",
  wakeSignature: "hull-sigpower-wake",
};

export function isEditableHull(hull) {
  return Boolean(hull) && !hull.hideInFleetEditor && !NON_EDITOR_HULL_NAMES.has(hull.name);
}

export function createIndexes(catalog) {
  const allHulls = catalog.hulls ?? [];
  const hulls = allHulls.filter(isEditableHull);
  const components = catalog.components ?? [];
  return {
    allHulls,
    hulls,
    components,
    hullByName: new Map(hulls.map((hull) => [hull.name, hull])),
    componentByName: new Map(components.map((component) => [component.name, component])),
    componentById: new Map(components.map((component) => [component.id, component])),
  };
}

export function createEmptyDesign(hull) {
  return {
    hullName: hull.name,
    slots: {},
  };
}

export function componentDisplayName(componentName) {
  return componentName || "Empty";
}

export function resolveDefaultComponentName(defaultComponent, indexes) {
  if (!defaultComponent) return "";
  if (indexes.componentByName.has(defaultComponent)) return defaultComponent;
  const withoutPrefix = defaultComponent.split("/").pop();
  if (indexes.componentByName.has(withoutPrefix)) return withoutPrefix;
  const lower = withoutPrefix.toLowerCase();
  const hit = indexes.components.find((component) => component.name.toLowerCase() === lower);
  return hit?.name ?? "";
}

export function hullEquipmentFaction(hull) {
  return hull?.overrideEquipmentFactionKey || hull?.factionKey || "";
}

export function isComponentAvailableForHull(component, hull) {
  const factionKey = component?.factionKey ?? "";
  return !factionKey || factionKey === hullEquipmentFaction(hull);
}

export function createDefaultDesign(hull, indexes) {
  const design = createEmptyDesign(hull);
  for (const socket of hull.sockets ?? []) {
    const componentName = resolveDefaultComponentName(socket.defaultComponent, indexes);
    const component = indexes.componentByName.get(componentName);
    if (component && isCompatible(socket, component, hull)) {
      design.slots[socket.shortName] = componentName;
    }
  }
  return design;
}

function sizeValues(size) {
  return SIZE_AXES.map((axis) => Number(size?.[axis] ?? 0));
}

function permutations(values) {
  const [a, b, c] = values;
  return [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ];
}

export function canFitSize(socketSize, componentSize, rotateToFit = 0) {
  const socket = sizeValues(socketSize);
  const component = sizeValues(componentSize);
  if (component.every((value) => value === 0)) return true;
  if (component.every((value, index) => value <= socket[index])) return true;
  if (!rotateToFit) return false;
  return permutations(component).some((candidate) =>
    candidate.every((value, index) => value <= socket[index]),
  );
}

export function isCompatible(socket, component, hull = null) {
  if (!socket || !component) return false;
  if (hull && !isComponentAvailableForHull(component, hull)) return false;
  return (
    socket.typeName === component.typeName &&
    canFitSize(socket.size, component.size, component.rotateToFit)
  );
}

export function compatibleComponents(socket, components, hull = null) {
  return components
    .filter((component) => isCompatible(socket, component, hull))
    .sort((a, b) => {
      const category = String(a.category ?? "").localeCompare(String(b.category ?? ""));
      if (category) return category;
      return String(a.name).localeCompare(String(b.name));
    });
}

export function componentForSlot(design, socket, indexes) {
  const componentName = design.slots[socket.shortName];
  return componentName ? indexes.componentByName.get(componentName) : null;
}

function resourceTotal(resources, name) {
  return resources
    .filter((resource) => resource.name === name)
    .reduce((sum, resource) => sum + Number(resource.amount ?? 0), 0);
}

function normalizeModifier(modifier) {
  return {
    statName: modifier?.statName ?? modifier?._statName ?? "",
    literal: Number(modifier?.literal ?? modifier?._literal ?? 0),
    modifier: Number(modifier?.modifier ?? modifier?._modifier ?? 0),
    permanent: Boolean(modifier?.permanent ?? modifier?._permanent),
  };
}

function statModifiers(modifiers, statName) {
  return (modifiers ?? [])
    .map(normalizeModifier)
    .filter((modifier) => modifier.statName === statName);
}

function applyStatModifiers(baseValue, modifiers, statName) {
  const matches = statModifiers(modifiers, statName);
  const literal = matches.reduce((sum, modifier) => sum + modifier.literal, 0);
  const multiplier = matches.reduce((sum, modifier) => sum + modifier.modifier, 1);
  const base = Number(baseValue ?? 0);
  return {
    base,
    literal,
    modifier: multiplier - 1,
    value: (base + literal) * multiplier,
  };
}

function componentResourceTotal(installed, resourceKey, resourceName) {
  return installed.reduce(
    (sum, item) => sum + resourceTotal(item.component[resourceKey] ?? [], resourceName),
    0,
  );
}

function mobilitySummary(hull, installed, totalMass) {
  const modifiers = [
    ...(hull.baseModifiers ?? []).map(normalizeModifier),
    ...installed.flatMap((item) => (item.component.modifiers ?? []).map(normalizeModifier)),
  ];
  const propulsion = installed.filter(
    (item) =>
      item.component.category === "Propulsion" ||
      item.component.bindToTag === "Thruster" ||
      (item.component.modifiers ?? []).some((modifier) =>
        String(modifier.statName ?? modifier._statName ?? "").startsWith("hull-"),
      ),
  );
  const linearMotor = applyStatModifiers(hull.linearMotorForce, modifiers, MOBILITY_STATS.linearMotor);
  const angularMotor = applyStatModifiers(hull.angularMotorForce, modifiers, MOBILITY_STATS.angularMotor);
  const mass = Math.max(Number(totalMass ?? 0), 1);
  return {
    modifiers,
    driveCount: propulsion.length,
    drivePower: componentResourceTotal(propulsion, "resourcesProvided", "Power"),
    driveNames: propulsion.map((item) => item.component.name),
    maxSpeed: applyStatModifiers(hull.maxSpeed, modifiers, MOBILITY_STATS.maxSpeed),
    turnRate: applyStatModifiers(hull.maxTurnSpeed, modifiers, MOBILITY_STATS.turnRate),
    linearMotor,
    angularMotor,
    wakeSignature: applyStatModifiers(
      hull.wakeSignatureStrength,
      modifiers,
      MOBILITY_STATS.wakeSignature,
    ),
    accelerationIndex: linearMotor.value / mass,
    turnIndex: angularMotor.value / mass,
  };
}

export function summarizeDesign(design, indexes) {
  const hull = indexes.hullByName.get(design.hullName) ?? indexes.hulls[0];
  const installed = [];
  for (const socket of hull.sockets ?? []) {
    const component = componentForSlot(design, socket, indexes);
    if (component) installed.push({ socket, component });
  }

  const componentCost = installed.reduce((sum, item) => sum + Number(item.component.pointCost ?? 0), 0);
  const componentMass = installed.reduce((sum, item) => sum + Number(item.component.mass ?? 0), 0);
  const crewRequired = installed.reduce((sum, item) => sum + Number(item.component.crewRequired ?? 0), 0);
  const powerProvided = installed.reduce(
    (sum, item) => sum + resourceTotal(item.component.resourcesProvided ?? [], "Power"),
    0,
  );
  const powerRequired = installed.reduce(
    (sum, item) => sum + resourceTotal(item.component.resourcesRequired ?? [], "Power"),
    0,
  );
  const totalMass = Number(hull.mass ?? 0) + componentMass;

  const warnings = [];
  const commandInstalled = installed.some((item) => item.component.category === "Command");
  if (!commandInstalled) warnings.push("No command component installed.");
  if (powerRequired > powerProvided) warnings.push(`Power deficit: ${powerRequired - powerProvided}`);
  for (const socket of hull.sockets ?? []) {
    if (socket.defaultComponent && !design.slots[socket.shortName]) {
      warnings.push(`${socket.shortName} default component is empty.`);
    }
  }

  return {
    hull,
    installed,
    totals: {
      pointCost: Number(hull.pointCost ?? 0) + componentCost,
      hullPointCost: Number(hull.pointCost ?? 0),
      componentPointCost: componentCost,
      mass: totalMass,
      hullMass: Number(hull.mass ?? 0),
      componentMass,
      crewComplement: Number(hull.crewComplement ?? 0),
      crewRequired,
      powerProvided,
      powerRequired,
      powerBalance: powerProvided - powerRequired,
      installedCount: installed.length,
      socketCount: hull.sockets?.length ?? 0,
    },
    mobility: mobilitySummary(hull, installed, totalMass),
    warnings,
  };
}

export function setSlotComponent(design, socket, component) {
  const next = {
    ...design,
    slots: { ...design.slots },
  };
  if (!component) {
    delete next.slots[socket.shortName];
  } else {
    next.slots[socket.shortName] = component.name;
  }
  return next;
}

export function serializeDesign(design) {
  return JSON.stringify(
    {
      hull: design.hullName,
      slots: design.slots,
    },
    null,
    2,
  );
}

export function parseDesign(text, indexes) {
  const parsed = JSON.parse(text);
  const hullName = parsed.hull ?? parsed.hullName;
  if (!indexes.hullByName.has(hullName)) {
    throw new Error(`Unknown hull: ${hullName}`);
  }
  const hull = indexes.hullByName.get(hullName);
  const socketNames = new Set((hull.sockets ?? []).map((socket) => socket.shortName));
  const slots = {};
  for (const [shortName, componentName] of Object.entries(parsed.slots ?? {})) {
    if (!socketNames.has(shortName)) continue;
    const component = indexes.componentByName.get(componentName);
    const socket = hull.sockets.find((item) => item.shortName === shortName);
    if (component && isCompatible(socket, component, hull)) {
      slots[shortName] = component.name;
    }
  }
  return { hullName, slots };
}
