---
permalink: discussions/announcing-v1.1.0/
layout: default
title: Announcing tresridge v1.1.0
description: The grammar stops being tied to .tres on disk, and the API stops being any in TypeScript. Neither changes an existing tree's verdict.
version: 1.1.0
---

# Announcing tresridge v1.1.0

`tresridge@1.1.0` is on npm. Two additive features: a host can now lint a tree whose records are not `.tres`, and a TypeScript host gets real types instead of `any`.

Neither one changes the verdict on a tree that already lints clean, so this is a minor cut. The grammar is untouched. What moved is everything around it that had quietly assumed Godot's file format.

## Why the format mattered at all

The grammar was always format-independent. Families are directories, records are files, a reference is a field naming another record's id - none of that says `.tres`. Only the walker and the parser were format-bound.

That mattered more than it sounds. A host with records in JSON had one path: convert the tree to `.tres` and lint the copy. That copy can drift from the real records, which puts the linter one sync away from judging a tree nobody ships. The lint could be clean and the game could still be broken, because the thing it read was a translation.

## `--reader`

A reader module supplies the pair that was hardcoded:

```js
export const reader = {
  name: '.json',
  walk(root) { /* absolute record paths, recursively */ },
  parse(file) { /* { id, idDeclared, scriptClass, fields, nested } */ },
};
```

Families, ids, edges, and every rule downstream are unchanged. That is the claim worth testing rather than asserting, so I tested it: a JSON record with `zone_id: "zn_missing"` and no matching zone produces

```text
FAIL  dangling-ref  zones/zn_a.json .zone_id  edge zones.zone_id -> zones, "zn_missing" not found
```

which is the same refusal, from the same rule, with the same code, as the `.tres` tree. The seam replaces the reader, not the law.

The module is validated when it loads. A reader missing `walk` or `parse` exits 2 and names the flag:

```text
tresridge: --reader module `reader.walk(root)` must be a function
```

That is deliberate. The alternative failure is a module that loads, walks nothing, and reports a clean lint over zero records - the one outcome a linter must never produce by accident. For the same reason `empty-tree` and `not-a-tree-root` now name the reader's suffix instead of hardcoding `.tres`, so the message says `no .json records under ...` when that is what it looked for.

There is one trap, and it is documented in the README because I hit it: the values in `fields` and `nested` must be **raw source text, quotes included** - `'"zn_a"'`, not `'zn_a'`. The `.tres` parser yields quoted text and the id reader scans for quoted values, so a reader returning bare strings parses fine, finds no quoted values, and reports **0 edges and a clean lint**. Nothing errors. Build the value with `JSON.stringify(id)`.

## Types

The package shipped no declarations, so a TypeScript host imported the API as `any` and lost the shapes the runtime already knew. `src/*.d.mts` now describe the root, `graph`, `rules`, and `tres` subpaths, `package.json` carries a `types` entry, and each subpath export became a `{ types, default }` condition so a resolver actually finds the declaration.

The declarations are gated by `npm run test:types`, which compares them against the real runtime exports in both directions: an export with no type fails, and so does a declared value the module no longer exports. That gate is worth being honest about. It checks names, not shapes - a wrong parameter type still passes. This is a floor that stops the declarations from silently drifting off the module, not a proof that they are correct.

## The numbers, measured

Every figure here came from a run against the built 1.1.0 tarball, not from memory.

The tarball is 22 files, 64437 bytes, and all four `.d.mts` files ship. A clean install answers `--version` with `1.1.0` and resolves `types` to `./src/lint.d.mts`. The committed fixture measures 6 families, 13 records, and 11 edges, and lints clean at 0 violations and 0 warnings. The refusal vocabulary is 15 codes. `lint-packs --deep` on the shipped reference pack reports 1 pack checked, 0 violations.

The reader seam was exercised end to end from the installed package: `graph` drafted a declaration from a JSON tree, `lint` judged it, and a deliberately dangling reference failed as it should.

## Adopting it

Nothing changes for a `.tres` host. `.tres` is still the default reader, and the upgrade is a version bump.

```bash
npx tresridge lint <tree>                        # unchanged
npx tresridge lint ./content --reader ./r.mjs    # a tree that is not .tres
```

## What 1.1.0 promises

The same thing 1.0.0 promised. A declaration written against SPEC v1 keeps its meaning across 1.x, and a refusal code keeps its meaning too. Both features here are additive and opt-in: a host that does not pass `--reader` reads exactly the tree it read at 1.0.0.

## Getting it

```bash
npx tresridge --version     # 1.1.0
npm i -D tresridge
```

Source, spec, and the refusal vocabulary live at [github.com/dhaupin/tresridge](https://github.com/dhaupin/tresridge). The spec in `spec/SPEC.md` is the normative source; the CLI implements it.
