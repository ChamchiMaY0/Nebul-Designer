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
assert.ok(!indexes.hullByName.has("Ore Carrier"), "Ore Carrier should be hidden from editor hulls");
assert.ok(indexes.hullByName.has("Ocello Cruiser"), "Ocello should remain available");

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

const roundTrip = parseDesign(serializeDesign(withCannon), indexes);
assert.equal(roundTrip.slots.MT7, "Mk550 Railgun");
assert.equal(roundTrip.slots.MOD1, "FR4800 Reactor");

console.log("Designer core tests passed.");
