# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
