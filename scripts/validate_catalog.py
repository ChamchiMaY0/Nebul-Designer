#!/usr/bin/env python3
"""Validate generated NEBULOUS catalog invariants."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("data/generated/catalog.json"),
        help="Generated catalog JSON to validate.",
    )
    return parser.parse_args()


def load_catalog(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Missing catalog: {path}")
    return json.loads(path.read_text())


def expect(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def by_name(rows: list[dict[str, Any]], name: str) -> Any:
    return next((row for row in rows if row.get("name") == name), None)


def validate(catalog: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    counts = catalog.get("metadata", {}).get("counts", {})
    hulls = catalog.get("hulls", [])
    components = catalog.get("components", [])
    munitions = catalog.get("munitions", [])

    expect(counts.get("hulls") == len(hulls), "metadata hull count does not match hulls", errors)
    expect(
        counts.get("components") == len(components),
        "metadata component count does not match components",
        errors,
    )
    expect(
        counts.get("munitions") == len(munitions),
        "metadata munition count does not match munitions",
        errors,
    )
    expect(len(hulls) >= 14, f"expected at least 14 hulls, got {len(hulls)}", errors)
    expect(
        len(components) >= 148,
        f"expected at least 148 components/drives/weapons, got {len(components)}",
        errors,
    )
    expect(len(munitions) >= 50, f"expected at least 50 munitions, got {len(munitions)}", errors)

    keystone = by_name(hulls, "Keystone Destroyer")
    expect(keystone is not None, "missing Keystone Destroyer", errors)
    if keystone:
        expect(keystone.get("pointCost") == 200, "Keystone pointCost should be 200", errors)
        expect(keystone.get("mass") == 8000.0, "Keystone mass should be 8000.0", errors)
        expect(keystone.get("maxSpeed") == 2.0, "Keystone maxSpeed should be 2.0", errors)
        expect(
            keystone.get("structure", {}).get("baseIntegrity") == 4000.0,
            "Keystone baseIntegrity should be 4000.0",
            errors,
        )
        sockets = keystone.get("sockets", [])
        summary = keystone.get("socketSummary", {})
        expect(len(sockets) == 21, f"Keystone should have 21 sockets, got {len(sockets)}", errors)
        expect(summary.get("mount") == 7, "Keystone should have 7 mount sockets", errors)
        expect(summary.get("compartment") == 7, "Keystone should have 7 compartment sockets", errors)
        expect(summary.get("module") == 7, "Keystone should have 7 module sockets", errors)
        first_socket = sockets[0] if sockets else {}
        expect(first_socket.get("shortName") == "MT1", "Keystone first socket should be MT1", errors)
        expect(first_socket.get("typeName") == "mount", "Keystone first socket should be mount", errors)

    samples = {
        "FR4800 Reactor": {"pointCost": 10, "typeName": "module", "mass": 40.0},
        "FM200 Drive": {"pointCost": 10, "typeName": "module", "mass": 35.0},
        "Mk65 Cannon": {"pointCost": 40, "typeName": "mount", "magazineSize": 3, "reloadTime": 13.0},
    }
    for name, expected in samples.items():
        row = by_name(components, name)
        expect(row is not None, f"missing component sample {name}", errors)
        if not row:
            continue
        for key, value in expected.items():
            expect(row.get(key) == value, f"{name} {key} should be {value!r}", errors)

    shell = by_name(munitions, "250mm HE Shell")
    expect(shell is not None, "missing 250mm HE Shell", errors)
    if shell:
        expect(shell.get("flightSpeed") == 80.0, "250mm HE Shell flightSpeed should be 80.0", errors)
        expect(
            shell.get("armorPenetration") == 40.0,
            "250mm HE Shell armorPenetration should be 40.0",
            errors,
        )
        expect(shell.get("componentDamage") == 80.0, "250mm HE Shell componentDamage should be 80.0", errors)

    return errors


def main() -> int:
    catalog = load_catalog(parse_args().catalog)
    errors = validate(catalog)
    if errors:
        print("Catalog validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    counts = catalog["metadata"]["counts"]
    print(
        "Catalog validation passed: "
        f"{counts['hulls']} hulls, {counts['components']} components, "
        f"{counts['munitions']} munitions, {counts['missiles']} missiles."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
