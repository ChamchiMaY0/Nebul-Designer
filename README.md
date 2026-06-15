# Nebul-Designer

External tooling experiments for building a NEBULOUS: Fleet Command ship
designer outside the game.

## Asset Catalog Extraction

The local game asset bundles are expected at:

```text
Asset/AssetBundles/stock
Asset/AssetBundles/stock-f1
Asset/AssetBundles/stock-f2
```

Those original bundles are intentionally ignored by git. They are large game
files and should be supplied locally by each developer.

Install the extractor dependency:

```sh
python3 -m pip install -r requirements.txt
```

Generate normalized JSON catalog files:

```sh
python3 scripts/extract_catalog.py
```

Validate the generated catalog against known sample values:

```sh
python3 scripts/validate_catalog.py
```

Generated files are written to `data/generated/`:

- `catalog.json`
- `hulls.json`
- `components.json`
- `munitions.json`
- `missiles.json`
- `metadata.json`
