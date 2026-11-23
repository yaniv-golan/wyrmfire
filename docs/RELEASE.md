# Releases and what CLOADM pins

Nothing has been released. A release is cut by the owner only: run the
**Release** workflow by hand with a version, or push a `vX.Y.Z` tag. It
creates a **draft** GitHub release; publishing the draft is a separate,
manual click. Branch pushes never release anything; CI's *Release dry run*
job runs the same build, tests and checks with version `0.0.0-dryrun` and
uploads the result as a workflow artifact only.

## Versioning

- Semantic versions `X.Y.Z`; the tag is `vX.Y.Z` and the release title
  `WYRMFIRE X.Y.Z`. Pre-release suffixes are not used for tags.
- A release is immutable: a fix is a new version, never a re-uploaded asset.
- `manifest.json` carries `schema: 1`. A breaking change to the manifest
  layout bumps `schema`; a change to the level disk format (`HGR2`/`HGA1`)
  is named in `levelFormat` and bumps the major version.

## Assets (exactly these eight; `tools/check-dist.mjs` refuses anything else)

| Asset | Role | Notes |
|---|---|---|
| `wyrmfire.bin` | engine | DragonDOS binary, 9-byte header `55 02 0C00 len 0C00 AA`: loads at `$0C00`, runs at `$0C00`, unpacks itself to `$1C00`. Byte-identical to the committed `bin/wyrmfire.bin` (checked in the workflow). |
| `wyrmfire.bin.sha256` | engine checksum | One line, `sha256sum` format: `<hex>  wyrmfire.bin`. |
| `wyrmfire.sym` | symbols | CMOC link map lines for `native.o`. |
| `wyrmfire-convert.js` | converter | ES module, no dependencies. WAD / zip / self-extractor / LHA in, level `.vdk` out. |
| `worker.js` | converter worker | Web Worker; imports `./wyrmfire-convert.js` (keep both in one directory). |
| `LICENSE` | licence | GPL-3.0-or-later. |
| `manifest.json` | metadata | Below. |
| `SHA256SUMS` | checksums | `sha256sum -c` format for every asset above except itself and `wyrmfire.bin.sha256`. |

No release carries a WAD, a level disk, or anything converted from a WAD
(Freedoom included): the player builds the level disk from their own WAD
with the converter.

## manifest.json

```json
{
 "schema": 1, "name": "WYRMFIRE", "version": "X.Y.Z", "tag": "vX.Y.Z",
 "licence": "GPL-3.0-or-later",
 "machine": { "id": "dragon64", "ram": 64, "video": "PAL", "controller": "dragonfdc", "controllerRom": false },
 "run": { "load": "wyrmfire.bin", "format": "dragondos-bin", "loadAddress": 3072, "exec": 3072,
          "levelDisk": { "drive": 0, "format": "vdk", "from": "converter" } },
 "levelFormat": { "pack": "HGR2", "assets": "HGA1" },
 "toolchain": { "cmoc": "0.1.101", "lwtools": "4.25" },
 "converter": { "version": "1.0.0", "module": "wyrmfire-convert.js", "worker": "worker.js" },
 "files": { "<asset>": { "sha256": "<hex>", "size": <bytes>, "role": "<role>", "description": "..." } }
}
```

`files` lists `wyrmfire.bin`, `wyrmfire.sym`, `wyrmfire-convert.js`,
`worker.js` and `LICENSE`.

## What CLOADM's pin needs

Pin per asset, never "latest":

1. **Tag**: `vX.Y.Z`.
2. **URL**: `https://github.com/yaniv-golan/wyrmfire/releases/download/vX.Y.Z/<asset>`.
3. **SHA-256 and size** of `wyrmfire.bin` (required) and of
   `wyrmfire-convert.js` + `worker.js` (if CLOADM offers in-browser
   conversion), copied from that release's `manifest.json`. Verify the
   download against both before use; a mismatch is a hard error.
4. **Run settings** from `manifest.run` / `manifest.machine`: Dragon 64,
   64 KB, PAL, `dragonfdc` without a controller ROM, level `.vdk` in drive 0
   and kept mounted, load `wyrmfire.bin` as a DragonDOS binary and `EXEC`
   `$0C00`.
5. **Level format** `HGR2`/`HGA1`: a converter and an engine from different
   releases may only be mixed if `levelFormat` is equal.

If cut from the current tree, `v0.1.0` would carry `wyrmfire.bin` with
SHA-256 `63fd0d1f9e9a450dd9487ba37f01c0c0e3ea0d997f3778412db52dd5f071fbcb`,
10,172 bytes. The other hashes follow the files at the tagged commit; take
them from the release's `manifest.json`, not from here.
