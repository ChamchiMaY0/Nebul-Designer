import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compatibleComponents,
  createDefaultDesign,
  createIndexes,
  parseDesign,
  serializeDesign,
  setSlotComponent,
  summarizeDesign,
} from "../web/designer-core.js";

const catalog = JSON.parse(readFileSync("data/generated/catalog.json", "utf8"));
const indexes = createIndexes(catalog);
const keystone = indexes.hullByName.get("Keystone Destroyer");

assert.ok(keystone, "Keystone Destroyer should exist");
assert.ok(!indexes.hullByName.has("Worden Fleet Carrier"), "Worden should be hidden from editor hulls");
assert.ok(indexes.hullByName.has("Ore Carrier"), "Ore Carrier should remain available as an OSP hull");
assert.ok(indexes.hullByName.has("Ocello Cruiser"), "Ocello should remain available");
assert.ok(indexes.hullByName.has("Bulker Line Ship"), "Bulker Line Ship should be available");
assert.ok(
  indexes.hullByName.has("Container Line Ship Refit"),
  "Container Line Ship Refit should be available",
);
assert.ok(!indexes.hullByName.has("Container Line Ship"), "Hidden base line ship should stay hidden");

const design = createDefaultDesign(keystone, indexes);
const summary = summarizeDesign(design, indexes);
assert.equal(summary.totals.socketCount, 21);
assert.equal(summary.totals.installedCount, 4);
assert.equal(design.slots.CMP1, "Basic CIC");
assert.equal(design.slots.MOD1, "FR4800 Reactor");
assert.equal(design.slots.MOD2, "FM200 Drive");
assert.equal(design.slots.MOD5, "RS35 'Frontline' Radar");
assert.equal(summary.totals.pointCost, 240);
assert.equal(summary.totals.powerBalance, 2700);
assert.equal(summary.mobility.driveCount, 1);
assert.equal(summary.mobility.drivePower, 500);
assert.equal(summary.mobility.maxSpeed.value, 2);

const mount7 = keystone.sockets.find((socket) => socket.shortName === "MT7");
const mountOptions = compatibleComponents(mount7, indexes.components, keystone);
assert.ok(mountOptions.some((component) => component.name === "Mk550 Railgun"));
assert.ok(!mountOptions.some((component) => component.name === "C30 Cannon"));

const withCannon = setSlotComponent(
  design,
  mount7,
  indexes.componentByName.get("Mk550 Railgun"),
);
const cannonSummary = summarizeDesign(withCannon, indexes);
assert.equal(cannonSummary.totals.pointCost, 315);
assert.equal(cannonSummary.totals.crewRequired, 55);
assert.equal(cannonSummary.totals.powerBalance, 700);

const driveSocket = keystone.sockets.find((socket) => socket.shortName === "MOD2");
const withDragonfly = setSlotComponent(
  design,
  driveSocket,
  indexes.componentByName.get("FM240 'Dragonfly' Drive"),
);
const dragonflySummary = summarizeDesign(withDragonfly, indexes);
assert.ok(dragonflySummary.mobility.maxSpeed.value < summary.mobility.maxSpeed.value);
assert.ok(dragonflySummary.mobility.turnRate.value > summary.mobility.turnRate.value);
assert.ok(dragonflySummary.mobility.angularMotor.value > summary.mobility.angularMotor.value);

const withRaider = setSlotComponent(
  design,
  driveSocket,
  indexes.componentByName.get("FM280 'Raider' Drive"),
);
const raiderSummary = summarizeDesign(withRaider, indexes);
assert.equal(raiderSummary.mobility.drivePower, 0);
assert.ok(raiderSummary.mobility.linearMotor.value > summary.mobility.linearMotor.value);

const containerRefit = indexes.hullByName.get("Container Line Ship Refit");
assert.equal(containerRefit.script, "RandomModularHull");
assert.equal(containerRefit.modular, true);
assert.equal(containerRefit.sockets.length, 25);
assert.ok(containerRefit.sockets.some((socket) => socket.sourcePart?.startsWith("Bow:")));

const roundTrip = parseDesign(serializeDesign(withCannon), indexes);
assert.equal(roundTrip.slots.MT7, "Mk550 Railgun");
assert.equal(roundTrip.slots.MOD1, "FR4800 Reactor");

console.log("Designer core tests passed.");
