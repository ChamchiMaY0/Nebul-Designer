export const SLOT_TYPE_LABELS = {
  mount: "Mount",
  compartment: "Compartment",
  module: "Module",
};

const SIZE_AXES = ["x", "y", "z"];

export function createIndexes(catalog) {
  const hulls = catalog.hulls ?? [];
  const components = catalog.components ?? [];
  return {
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

export function createDefaultDesign(hull, indexes) {
  const design = createEmptyDesign(hull);
  for (const socket of hull.sockets ?? []) {
    const componentName = resolveDefaultComponentName(socket.defaultComponent, indexes);
    if (componentName) {
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

export function isCompatible(socket, component) {
  if (!socket || !component) return false;
  return (
    socket.typeName === component.typeName &&
    canFitSize(socket.size, component.size, component.rotateToFit)
  );
}

export function compatibleComponents(socket, components) {
  return components
    .filter((component) => isCompatible(socket, component))
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
      mass: Number(hull.mass ?? 0) + componentMass,
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
    if (component && isCompatible(socket, component)) {
      slots[shortName] = component.name;
    }
  }
  return { hullName, slots };
}

