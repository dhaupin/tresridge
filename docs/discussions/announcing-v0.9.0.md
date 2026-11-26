---
permalink: discussions/announcing-v0.9.0/
layout: default
title: Announcing tresridge v0.9.0
description: The first registry cut - the .tres relation standard, the CLI, and the reference pack are on npm, so npx tresridge resolves from any machine.
version: 0.9.0
---

# Announcing tresridge v0.9.0

tresridge is on npm. `tresridge@0.9.0` is the first registry cut: the standard, the CLI, and the reference pack ship as one package, so `npx tresridge` resolves from any machine with no checkout and no install step.

That sentence was false for every release before this one. The repo has been usable as a CLI invoked from a checkout since v0.1, and the README said so plainly. What changed is that the package page now exists, and the command it always advertised works.

## What tresridge does

Point it at a tree of `.tres` records and it tells you what you have, what dangles, and what is undeclared. The law is one line: declare the edge, resolve or refuse. A dangling id is a warning in a log nobody reads at playtest time; tresridge moves that refusal to author time and names the file.

Five verbs, and each one answers a different question:

| verb | what it does |
| ---- | ------------ |
| `lint` | every declared edge resolves; no undeclared `_id`; no cycles |
| `graph` | infer a first-draft declaration from the tree |
| `doctor` | lint plus graph residue plus a summary of what needs declaring |
| `rules` | the refusal vocabulary this lint carries |
| `lint-packs` | check packs against the packstruct contract |

The exit contract is `0` clean, `1` violations, `2` usage. Fifteen refusal codes back it, and `rules --json` prints the whole vocabulary so a host can gate on it.

## The numbers, measured

Every figure below came from a run against the shipped package, not from memory. The committed fixture in `conformance/fixture/` measures 6 families, 13 records, 3 edges inferred, and 2 fields needing declaration, and it lints clean with 0 violations and 0 warnings. `npm run docs:check` re-measures that block on every run and refuses drift, which is why the numbers here can be trusted to still be true.

The tarball itself is 18 files. It carries `bin/`, `src/`, `spec/`, and the reference pack at `packs/public/godot-shapes/`, including the coverage fixture that `lint-packs --deep` requires. A clean install answers `--version` with `0.9.0`, and `lint-packs --deep` on the installed pack reports 1 pack checked, 0 violations.

## Adopting it

```bash
npx tresridge doctor <tree>            # what you have
npx tresridge graph <tree> --out relations.json   # a first-draft declaration
npx tresridge lint <tree>              # judge it
```

`graph` is the on-ramp. It derives a declaration from a tree you already have, so you start from truth instead of a blank page, then edit the draft rather than authoring it. A host that wants its own law adds rules with `--rules <module>` or a pack with `--packs <dir>`.

## What this cut is not

It is a manual publish, and that has one visible consequence: the tarball carries no provenance attestation, because npm's OIDC Trusted Publishing lane cannot be the first publisher of a new package name. The tag-driven lane with attestation takes over at 1.0.0. Until then a `vX.Y.Z` tag still cuts the GitHub release and runs the verify ladder against the served bytes, so a 0.x cut is proof-carrying even without the attestation.

The site rig, the landing page, and these docs are younger than the tool. They are gated like everything else, but the tool is the stable part.

## Getting it

```bash
npx tresridge --version     # 0.9.0
npm i -D tresridge
```

Source, spec, and the refusal vocabulary live at [github.com/dhaupin/tresridge](https://github.com/dhaupin/tresridge). The spec in `spec/SPEC.md` is the normative source; the CLI implements it.
