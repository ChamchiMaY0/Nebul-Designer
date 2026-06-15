#!/usr/bin/env python3
"""Extract a compact NEBULOUS catalog from local Unity AssetBundles."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable

try:
    import UnityPy
except ImportError as exc:  # pragma: no cover - exercised by users without deps
    raise SystemExit(
        "UnityPy is required. Install it with: python3 -m pip install -r requirements.txt"
    ) from exc


DEFAULT_BUNDLES = ("stock", "stock-f1", "stock-f2")
SOCKET_TYPES = {0: "mount", 1: "compartment", 2: "module"}
COMPONENT_TYPES = {0: "mount", 1: "compartment", 2: "module"}
SOCKET_PREFIXES = {"mount": "MT", "compartment": "CMP", "module": "MOD"}
HULL_SCRIPTS = {"Hull", "RandomModularHull"}
MODULAR_PART_GROUPS = (
    ("_bows", "Bow"),
    ("_cores", "Core"),
    ("_sterns", "Stern"),
)

COMMON_COMPONENT_FIELDS = (
    "_partKey",
    "_saveKey",
    "_modId",
    "_factionKey",
    "_shortUIName",
    "_shortDescription",
    "_longDescription",
    "_category",
    "_costBreakdownClass",
    "_pointCost",
    "_type",
    "_size",
    "_interiorOverhang",
    "_mass",
    "_bindToTag",
    "_rotateToFit",
    "_canTile",
    "_consistentCostForTiled",
    "_maxHealth",
    "_functioningThreshold",
    "_damageThreshold",
    "_reinforced",
    "_dcPriority",
    "_casualtyClass",
    "_resourceDemandPriority",
    "_crewRequired",
    "_reinforceCrewAt",
    "_jobName",
)

ROLE_SPECIFIC_COMPONENT_FIELDS = (
    "_compatibleAmmoTags",
    "_detailType",
    "_magazineSize",
    "_reloadTime",
    "_reloadStatSubtype",
    "_recycleStatSubtype",
    "_timeBetweenMuzzles",
    "_traverseRate",
    "_elevationRate",
    "_minElevation",
    "_maxElevation",
    "_role",
    "_ewType",
    "_utilityType",
    "_pdtTargetMethod",
    "_maxRange",
    "_radiatedPower",
    "_gain",
    "_sensitivity",
    "_apertureSize",
    "_noiseFiltering",
    "_maxError",
    "_maxVelocityError",
    "_canLock",
    "_maintainLockSNR",
    "_collectsIntel",
    "_sigType",
    "_elintCategory",
    "_stackingSensorID",
    "_channels",
    "_transmitPower",
    "_broadcastRange",
)

MUNITION_FIELDS = (
    "_munitionKey",
    "_munitionName",
    "_factionKey",
    "_pointCost",
    "_pointDivision",
    "_storageVolume",
    "_tags",
    "_role",
    "_recommendedTargetTypes",
    "_magazineMonitorType",
    "_maxFlightTime",
    "_flightSpeed",
    "_repoolDelay",
    "_armorPenetration",
    "_armorDamageRadius",
    "_heatPower",
    "_componentDamage",
    "_crewVulnerabilityMultiplier",
    "_maxPenetrationDistance",
    "_overpenDamageMultiplier",
    "_explosionRadius",
    "_dedicatedStructureDamage",
    "_wallThickness",
    "_stoppedHitDamageReduction",
    "_maxHealth",
    "_size",
    "_missileType",
    "_missileClass",
    "_designationBase",
    "_missileDesignation",
    "_missileNickname",
    "_bodySubtitle",
    "_bodyFunctionalDescription",
    "_socketWeight",
    "_socketWeightCostScaling",
    "_uniformSocketCostScaling",
    "_maxTurnRate",
    "_acceleration",
    "_boostPhaseDuration",
    "_programmingTimeRequired",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--asset-dir",
        type=Path,
        default=Path("Asset/AssetBundles"),
        help="Directory containing stock, stock-f1, and stock-f2 bundles.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/generated"),
        help="Directory for generated JSON catalog files.",
    )
    parser.add_argument(
        "--bundle",
        action="append",
        dest="bundles",
        help="Bundle filename to extract. Defaults to stock, stock-f1, stock-f2.",
    )
    return parser.parse_args()


def script_name(component: Any) -> str:
    if component.object_reader.type.name != "MonoBehaviour":
        return component.object_reader.type.name
    try:
        return component.m_Script.read().m_Name
    except Exception:
        return "<unknown>"


def read_tree(obj: Any) -> dict[str, Any]:
    return obj.object_reader.read_typetree()


def vector(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        keys = [key for key in ("x", "y", "z", "w") if key in value]
        return {key: value[key] for key in keys}
    keys = [key for key in ("x", "y", "z", "w") if hasattr(value, key)]
    if not keys:
        return None
    return {key: getattr(value, key) for key in keys}


def simple(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [simple(item) for item in value]
    if isinstance(value, tuple):
        return [simple(item) for item in value]
    if isinstance(value, dict):
        if set(value.keys()) <= {"m_FileID", "m_PathID"}:
            return None if value.get("m_PathID", 0) == 0 else dict(value)
        return {key: simple(item) for key, item in value.items()}
    vec = vector(value)
    if vec is not None:
        return vec
    return str(value)


def safe_path_id(obj: Any) -> int | None:
    return getattr(getattr(obj, "object_reader", None), "path_id", None)


def first_monobehaviour(
    game_object: Any, predicate: Callable[[Any, str, dict[str, Any]], bool]
) -> tuple[Any, Any, Any]:
    for pointer in getattr(game_object, "m_Components", []):
        try:
            component = pointer.read()
        except Exception:
            continue
        if component.object_reader.type.name != "MonoBehaviour":
            continue
        name = script_name(component)
        try:
            tree = read_tree(component)
        except Exception:
            continue
        if predicate(component, name, tree):
            return component, name, tree
    return None, None, None


def all_monobehaviours(game_object: Any) -> list[tuple[Any, str, dict[str, Any]]]:
    rows = []
    for pointer in getattr(game_object, "m_Components", []):
        try:
            component = pointer.read()
        except Exception:
            continue
        if component.object_reader.type.name != "MonoBehaviour":
            continue
        try:
            rows.append((component, script_name(component), read_tree(component)))
        except Exception:
            continue
    return rows


def component_resources(tree: dict[str, Any], key: str) -> list[dict[str, Any]]:
    resources = []
    for item in tree.get(key) or []:
        if isinstance(item, dict):
            resources.append(
                {
                    "name": item.get("_resourceName"),
                    "amount": item.get("_amount"),
                    "perUnit": bool(item.get("_perUnit", 0)),
                    "onlyWhenOperating": bool(item.get("_onlyWhenOperating", 0)),
                }
            )
    return resources


def component_modifiers(tree: dict[str, Any], key: str = "Modifiers") -> list[dict[str, Any]]:
    modifiers = []
    for item in tree.get(key) or []:
        if isinstance(item, dict):
            modifiers.append(
                {
                    "statName": item.get("_statName"),
                    "literal": item.get("_literal"),
                    "modifier": item.get("_modifier"),
                    "permanent": bool(item.get("_permanent", 0)),
                }
            )
    return modifiers


def clean_key(key: str) -> str:
    return key[1:] if key.startswith("_") else key


def pick_fields(tree: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    result = {}
    for key in fields:
        if key not in tree:
            continue
        value = simple(tree[key])
        if key in {"_longDescription", "_flavorText", "_optionalFlavorText", "_descriptionText"}:
            result[clean_key(key) + "Key"] = value
        else:
            result[clean_key(key)] = value
    return result


def socket_component(game_object: Any) -> tuple[Any, Any]:
    component, _name, tree = first_monobehaviour(
        game_object, lambda _component, name, _tree: name == "HullSocket"
    )
    return component, tree


def transform_from_root(root: Any) -> Any | None:
    if getattr(root.object_reader.type, "name", "") == "Transform":
        return root
    if getattr(root.object_reader.type, "name", "") != "GameObject":
        return None
    for pointer in getattr(root, "m_Components", []):
        try:
            component = pointer.read()
        except Exception:
            continue
        if component.object_reader.type.name == "Transform":
            return component
    return None


def socket_short_name(
    tree: dict[str, Any],
    socket_type_name: str,
    counters: Counter | None,
    renumber: bool,
) -> str:
    original = tree.get("_shortName") or ""
    if not renumber:
        return original
    prefix = SOCKET_PREFIXES.get(socket_type_name, "SKT")
    if counters is None:
        return original or prefix
    counters[prefix] += 1
    return f"{prefix}{counters[prefix]}"


def socket_records_from_root(
    root: Any,
    counters: Counter | None = None,
    source_part: str | None = None,
    renumber: bool = False,
) -> list[dict[str, Any]]:
    sockets = []
    transform_root = transform_from_root(root)
    if transform_root is None:
        return sockets
    for child_ptr in getattr(transform_root, "m_Children", []):
        try:
            transform = child_ptr.read()
            game_object = transform.m_GameObject.read()
            _socket, tree = socket_component(game_object)
        except Exception as exc:
            sockets.append({"error": str(exc)})
            continue
        if not tree:
            continue
        socket_type = tree.get("_type")
        type_name = SOCKET_TYPES.get(socket_type, f"unknown-{socket_type}")
        record = {
            "name": game_object.m_Name,
            "key": tree.get("_key"),
            "shortName": socket_short_name(tree, type_name, counters, renumber),
            "type": socket_type,
            "typeName": type_name,
            "size": simple(tree.get("_size")),
            "position": vector(transform.m_LocalPosition),
            "rotation": vector(transform.m_LocalRotation),
            "scale": vector(transform.m_LocalScale),
            "interiorOverhangSpace": tree.get("_interiorOverhangSpace"),
            "attachPoint": simple(tree.get("_attachPoint")),
            "defaultComponent": tree.get("_defaultComponent") or "",
            "traverseLimits": simple(tree.get("_traverseLimits")),
            "forwardLimits": simple(tree.get("_forwardLimits")),
            "unmaskAxis": tree.get("_unmaskAxis"),
            "unmaskSide": tree.get("_unmaskSide"),
            "socketUVMin": simple(tree.get("_socketUVMin")),
            "socketUVMax": simple(tree.get("_socketUVMax")),
            "socketUVRot": tree.get("_socketUVRot"),
        }
        if renumber:
            record["rawShortName"] = tree.get("_shortName") or ""
        if source_part:
            record["sourcePart"] = source_part
        sockets.append(record)
    return sockets


def extract_sockets(hull_component: Any) -> list[dict[str, Any]]:
    try:
        root = hull_component._socketRoot.read()
    except Exception:
        return []
    return socket_records_from_root(root)


def extract_modular_part_counts(hull_component: Any) -> dict[str, int]:
    counts = {}
    for key in ("_bows", "_cores", "_sterns", "_superstructures"):
        counts[key[1:]] = len(getattr(hull_component, key, []) or [])
    return counts


def extract_modular_sockets(hull_component: Any) -> list[dict[str, Any]]:
    sockets: list[dict[str, Any]] = []
    counters: Counter = Counter()
    for attr, label in MODULAR_PART_GROUPS:
        part_pointers = getattr(hull_component, attr, []) or []
        if not part_pointers:
            continue
        try:
            part = part_pointers[0].read()
            part_tree = read_tree(part)
            root = part._socketRoot.read()
        except Exception:
            continue
        part_key = part_tree.get("_key") or f"{label} 1"
        sockets.extend(
            socket_records_from_root(
                root,
                counters=counters,
                source_part=f"{label}: {part_key}",
                renumber=True,
            )
        )
    return sockets


def box_record(box: Any) -> dict[str, Any]:
    if not isinstance(box, dict):
        return {}
    return {
        "center": simple(box.get("m_Center")),
        "extent": simple(box.get("m_Extent")),
    }


def extract_hull_geometry(hull_component: Any) -> dict[str, Any]:
    geometry: dict[str, Any] = {"volumes": []}
    try:
        volume = hull_component._randomPointVolume.read()
        volume_tree = read_tree(volume)
        geometry["lineBackZ"] = volume_tree.get("_lineBackZ")
        geometry["lineForwardZ"] = volume_tree.get("_lineForwardZ")
        for item in volume_tree.get("_subVolumes") or []:
            if isinstance(item, dict):
                geometry["volumes"].append(
                    {
                        **box_record(item.get("Box")),
                        "weight": item.get("Weight"),
                    }
                )
    except Exception:
        pass

    try:
        radar = hull_component._radarSignature.read()
        radar_tree = read_tree(radar)
        geometry["radarSignature"] = box_record(radar_tree.get("_sigSize"))
    except Exception:
        pass

    try:
        select_volume = hull_component._selectVolume.read()
        select_tree = read_tree(select_volume)
        geometry["selectVolume"] = {
            "center": simple(select_tree.get("m_Center")),
            "size": simple(select_tree.get("m_Size")),
        }
    except Exception:
        pass

    return geometry


def extract_hull(
    path: str,
    game_object: Any,
    hull_component: Any,
    script: str,
    tree: dict[str, Any],
) -> dict[str, Any]:
    is_modular = script == "RandomModularHull"
    sockets = extract_modular_sockets(hull_component) if is_modular else extract_sockets(hull_component)
    socket_counts = Counter(socket.get("typeName") for socket in sockets)
    record = {
        "id": tree.get("_className") or game_object.m_Name,
        "name": game_object.m_Name,
        "assetPath": path,
        "script": script,
        "modular": is_modular,
        "className": tree.get("_className"),
        "typeClassification": tree.get("_typeClassification"),
        "hullClassification": tree.get("_hullClassification"),
        "factionKey": tree.get("_factionKey"),
        "overrideEquipmentFactionKey": tree.get("_overrideEquipmentFactionKey"),
        "hideInFleetEditor": bool(tree.get("_hideInFleetEditor", 0)),
        "longDescriptionKey": tree.get("_longDescription"),
        "pointCost": tree.get("_pointCost"),
        "mass": tree.get("_mass"),
        "weightClass": tree.get("_weightClass"),
        "tankFacing": tree.get("_tankFacing"),
        "armorAspect": simple(tree.get("_armorAspect")),
        "maxSpeed": tree.get("_maxSpeed"),
        "maxTurnSpeed": tree.get("_maxTurnSpeed"),
        "linearMotorForce": tree.get("_linearMotorForce"),
        "angularMotorForce": tree.get("_angularMotorForce"),
        "crewComplement": tree.get("_crewComplement"),
        "crewVulnerability": tree.get("_crewVulnerability"),
        "interiorDensityArmorEquivalent": tree.get("_interiorDensityArmorEquivalent"),
        "componentDamageReduction": tree.get("_componentDR"),
        "visionDistance": tree.get("_visionDistance"),
        "identityWorkRequired": tree.get("_identityWorkRequired"),
        "baseModifiers": simple(tree.get("BaseModifiers")),
        "wakeSignatureStrength": tree.get("_wakeSigStrength"),
        "baseCraftRepairSlots": tree.get("_baseCraftRepairSlots"),
        "fuelUnitCapacity": tree.get("_fuelUnitCapacity"),
        "storageTransferRate": tree.get("_storageTransferRate"),
        "sockets": sockets,
        "socketSummary": dict(socket_counts),
        "geometry": extract_hull_geometry(hull_component),
    }
    if is_modular:
        record["layoutMode"] = "representative-first-variant"
        record["modularPartCounts"] = extract_modular_part_counts(hull_component)
    try:
        structure = hull_component._structure.read()
        structure_tree = read_tree(structure)
        record["structure"] = {
            "baseIntegrity": structure_tree.get("_baseIntegrity"),
            "minDamageToCount": structure_tree.get("_minDamageToCount"),
        }
    except Exception:
        record["structure"] = {}
    return record


def extract_component(
    path: str, game_object: Any, component: Any, name: str, tree: dict[str, Any]
) -> dict[str, Any]:
    record = {
        "id": tree.get("_partKey") or game_object.m_Name,
        "name": game_object.m_Name,
        "assetPath": path,
        "script": name,
    }
    record.update(pick_fields(tree, COMMON_COMPONENT_FIELDS))
    record.update(pick_fields(tree, ROLE_SPECIFIC_COMPONENT_FIELDS))
    if "type" in record:
        record["typeName"] = COMPONENT_TYPES.get(record["type"], f"unknown-{record['type']}")
    record["resourcesProvided"] = component_resources(tree, "ResourcesProvided")
    record["resourcesRequired"] = component_resources(tree, "ResourcesRequired")
    record["modifiers"] = component_modifiers(tree)
    return record


def missile_sockets(tree: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for socket in tree.get("_sockets") or []:
        if isinstance(socket, dict):
            result.append(simple(socket))
    return result


def extract_munition(path: str, obj: Any, name: str, tree: dict[str, Any]) -> dict[str, Any]:
    record = {
        "id": tree.get("_munitionKey") or tree.get("_bodySaveKey") or getattr(obj, "m_Name", ""),
        "name": getattr(obj, "m_Name", "") or tree.get("_munitionName") or tree.get("_missileDesignation"),
        "assetPath": path,
        "script": name,
    }
    record.update(pick_fields(tree, MUNITION_FIELDS))
    sockets = missile_sockets(tree)
    if sockets:
        record["sockets"] = sockets
        record["socketCount"] = len(sockets)
    return record


def load_bundle(bundle_path: Path) -> Any:
    if not bundle_path.exists():
        raise FileNotFoundError(f"Missing bundle: {bundle_path}")
    return UnityPy.load(str(bundle_path))


def extract_catalog(asset_dir: Path, bundle_names: list[str]) -> dict[str, Any]:
    catalog: dict[str, Any] = {
        "metadata": {
            "formatVersion": 1,
            "source": "NEBULOUS Fleet Command local AssetBundles",
            "bundles": bundle_names,
            "notes": [
                "Generated from local Unity AssetBundles.",
                "Long prose descriptions are intentionally omitted; localization keys are preserved.",
            ],
        },
        "hulls": [],
        "components": [],
        "munitions": [],
        "missiles": [],
        "skipped": [],
    }

    for bundle_name in bundle_names:
        env = load_bundle(asset_dir / bundle_name)
        for path, pointer in sorted(env.container.items(), key=lambda item: item[0]):
            lower = path.lower()
            if not (lower.endswith(".prefab") or lower.endswith(".asset")):
                continue
            try:
                obj = pointer.read()
            except Exception as exc:
                catalog["skipped"].append({"assetPath": path, "reason": f"read failed: {exc}"})
                continue

            if obj.object_reader.type.name == "GameObject":
                if "/hulls/" in lower:
                    hull, script, tree = first_monobehaviour(
                        obj, lambda _component, name, _tree: name in HULL_SCRIPTS
                    )
                    if hull:
                        catalog["hulls"].append(extract_hull(path, obj, hull, script, tree))
                    continue

                if any(segment in lower for segment in ("/components/", "/drives/", "/weapons/")):
                    component, script, tree = first_monobehaviour(
                        obj, lambda _component, _name, tree: "_partKey" in tree
                    )
                    if component:
                        catalog["components"].append(extract_component(path, obj, component, script, tree))
                    continue

                if "/munitions/" in lower:
                    component, script, tree = first_monobehaviour(
                        obj,
                        lambda _component, name, tree: name == "ModularMissile"
                        or "_munitionKey" in tree
                        or "_missileDesignation" in tree,
                    )
                    if component:
                        target = "missiles" if script == "ModularMissile" else "munitions"
                        catalog[target].append(extract_munition(path, obj, script, tree))
                    continue

            if obj.object_reader.type.name == "MonoBehaviour" and "/munitions/" in lower:
                script = script_name(obj)
                tree = read_tree(obj)
                catalog["munitions"].append(extract_munition(path, obj, script, tree))

    for key in ("hulls", "components", "munitions", "missiles"):
        catalog[key].sort(key=lambda item: (item.get("factionKey", ""), item.get("name", "")))
    catalog["metadata"]["counts"] = {
        "hulls": len(catalog["hulls"]),
        "components": len(catalog["components"]),
        "munitions": len(catalog["munitions"]),
        "missiles": len(catalog["missiles"]),
        "skipped": len(catalog["skipped"]),
    }
    return catalog


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def main() -> int:
    args = parse_args()
    bundle_names = args.bundles or list(DEFAULT_BUNDLES)
    catalog = extract_catalog(args.asset_dir, bundle_names)

    output_dir = args.output_dir
    write_json(output_dir / "catalog.json", catalog)
    for key in ("hulls", "components", "munitions", "missiles"):
        write_json(output_dir / f"{key}.json", catalog[key])
    write_json(output_dir / "metadata.json", catalog["metadata"])

    counts = catalog["metadata"]["counts"]
    print(
        "Generated catalog: "
        f"{counts['hulls']} hulls, {counts['components']} components, "
        f"{counts['munitions']} munitions, {counts['missiles']} missiles, "
        f"{counts['skipped']} skipped."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
