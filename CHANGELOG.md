# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### The site rig (coreforge landing + docs)

tresridge now ships its own front door: a landing site and a docs site, driven from one
identity file. The rig is `coreforge`, adopted (not vendored) as a single root devDependency,
so a gate or lane fix arrives with `npm update coreforge` rather than a re-copy.

- **`site.config.js`** - THE site identity: name, tagline, url, repo, maker, the docs block,
  the theme block, the nav vocabulary, and the routes. The brand census gate refuses an
  identity literal that lives anywhere else.
- **`npm run site:sync`** fans the identity out to the derived surfaces (`docs/_config.yml`,
  `docs/freestruct.config.yml`, `web/public/robots.txt`, `web/public/site.webmanifest`).
  `site:sync:check` refuses drift and is what CI runs.
- **`npm run site:check`** / **`site:doctor`** - the gates (brand census, docs frontmatter,
  links, style, fiction signatures, Liquid filter trap, theme parity, language, birth-gate)
  and the truth battery.
- **The landing** (`web/`) is a prestruct React/Vite prerender; **the docs** (`docs/`) are
  Jekyll. Both build in CI.
- **`.github/workflows/test.yml`** now runs two jobs: the **tool battery** (`check:tool` on
  Node 20 and 22) and the **site battery** (gates, `sync --check`, the web build, the docs
  build). Every action is SHA-pinned with its human tag in a trailing comment.
- **`.github/workflows/docs-deploy.yml`** is a thin caller of the one family docs lane
  (dhaupin/freestruct, pinned); **`staging-ff-sync.yml`** keeps `staging` a fast-forward
  mirror of `main`.
- **No `packs/`.** The rig ships a `packs/` slot for site adopters; tresridge's extension
  surface is `--rules <module>` plus `profiles/`, so the slot is not present and the
  duplicate is not shipped.

`npm run check` is now tool battery plus site gates; `check:tool` keeps the tool-only lane.

### The enforcement layer (the spec becomes checkable)

The first cut had the refusals hardcoded inline in `lint.mjs` - seven in the code, six in the spec table, and two of the spec's six not implemented. Four silent drifts, and no way to add a rule without editing the lint. The definition and the enforcement could disagree, which is the opposite of "define it, enforce it."

Now they cannot:

- **`spec/refusals.json`** - the shared refusal vocabulary. Plain JSON, so a non-JS host reads what the JS lint reads. Eleven codes.
- **`src/rules.mjs`** - the rule registry. `src/lint.mjs` is a facade; the lint holds no refusals of its own.
- **`scripts/check-vocabulary.mjs`** - the gate. Refuses an undocumented refusal, a promise with no check, an unproven refusal, or a section 7 table that drifted from its data. The table is now GENERATED from the vocabulary.
- **Baselines (mitigations with teeth)** - a refusal can be excused, on the record, with a reason and a clock. Expired baselines stop excusing (`baseline-expired`); unmatched ones are reported (`baseline-unmatched`). No `--ignore`, no `--force`.
- **The extension surface** - `--rules <module>` / `opts.extraRules` and the `rules` verb. A host adds rules; a rule may not invent a code and may not weaken a standing refusal. `profiles/godot/` is the reference.
- **Two rules that were promised but never implemented** now exist: `name-dir-mismatch`, `filename-id-mismatch`. The latter honors a family's `idPrefix` (the filename is prefix + id), which `graph` now infers.

Battery grew 10 -> 15 rows, all observed honest. `npm run check` is now three steps: battery, drift gate, vocabulary gate.

## [0.1.0] - 2026-11-17

The first cut. Spec, front door, and CLI land together.

### Added

- `spec/SPEC.md` - the normative grammar: the family table, the edge table, five edge
  kinds (`ref`, `refs`, `nested`, `virtual`, `literal`), the resolution rule, the refusal
  vocabulary, and the units table.
- `bin/cli.mjs` + `src/{tres,lint,graph}.mjs` - the conformance CLI (`lint` / `graph` /
  `doctor`), zero runtime deps, exit contract 0/1/2.
- `labs/refusal-battery/<id>.json` - ten portable malformed-shape fixtures.
- `scripts/gen-refusal-matrix.mjs` - the no-fiction generator: it materializes each
  fixture, runs the REAL lint over the bytes, and refuses its own run when any observed
  verdict disagrees with expectation. `--check` is the drift gate.
- `labs/refusal-matrix.tresridge.json` - the committed column, observed never
  hand-derived.
- `conformance/cases/` - the same ten cases in on-disk tree form, emitted from the same
  definitions so the two forms cannot drift.
- `labs/prd-tresridge.md`, `labs/TASKS.md`, `AGENTS.md`, `DEPLOY.md`.

### Corrected by measurement

The first run against the reference deployment's 1097 records refused five rules the spec
had invented. All five were fixed in `SPEC.md`, not worked around:

- **Units named.** "Edge" had been three different counts (344 reference instances, 61
  declaration pairs, 57 inferred pairs). The spec now carries a units table.
- **`schema` is optional and advisory.** A family is not one schema (`balance/` holds
  twelve); a mixed family declares none.
- **`target` may be a union.** Item ids live across `weapons/`, `armors/`, `resources/`,
  ... so `target` may be an array of keys.
- **`key` is not kebab-case.** The reference tree's directories are snake_case.
- **An id is lowercase-led.** A PascalCase token in an `_id` field is a class name, not a
  reference - the case the `literal` kind exists for.

Two tool bugs were caught by the same run: the cycle detector followed the declaring
family instead of the target family, and the extractor counted class names as id
references.
