# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-11-20

The first registry cut. Everything below landed after 0.1.0 and before the
package reached npm: the enforcement layer that makes the spec checkable, the
site rig, the measured-numbers discipline, and the silent-pass class of fixes.
0.9.0 is the last of the manual lane - a human runs `npm publish` from a clean
`main`, and the tag-driven OIDC ladder takes over at 1.0.0.

### The ship lane: the first publish is scripted, not typed

The first push of a new package name cannot use OIDC - Trusted Publishing is
configured per existing package - so the first cut is a human with a token.
`scripts/ship-from-download.cjs` stages a downloaded zip tree (no `.git`, no
`node_modules`, a FUSE download folder that refuses symlinks), installs, publishes
with a token held only in the child env, and unlinks the staged `.npmrc` in a
`finally`. Refusals are named and exit 2; it never deletes on its own. `npm run
ship`, with `--dry-run` first. 21 behavior tests, wired into `npm run check`.

### `--version` answers, so the release ladder can pass

`verify-release` installs the published tarball and asserts `tresridge --version`
answers the packaged version. The CLI had no such handler: it printed the usage
block and exited **2**, so the ladder could never pass on a real cut - a defect
only a publish would have found. `--version` / `-v` now print the version read
from `package.json` (never a restated literal, which is a second source that
drifts) and exit 0. Three CLI checks fail if the handler is reverted.

### The silent-pass class: a wrong root is now a refusal

Seven defects shared one shape: the tool completed successfully while measuring the
wrong thing. Each is now a named refusal or a gate, and each has a test that fails
when the fix is reverted.

- **`not-a-tree-root`** (new refusal, exit 2). A root above the tree root collapsed
  every record into one family, so no edge could resolve: `graph` inferred **0 edges**
  and exited **0**, which reads as a clean tree. A root pointed at one family
  directory made every record its own family. Both now refuse and name a directory
  that does read as a root. The detection is deliberately narrow - one family spanning
  several directories **and** several schemas for "too high", family keys ending in
  `.tres` for "too low" - so a legal tree (including a mixed family) never trips it.
- **`empty-tree`** (new refusal, exit 2). A clean verdict over zero records is vacuous,
  and vacuous is the shape a silent failure takes.
- **Declaration discovery.** `--decl` defaulted to `./relations.json`, so `doctor` run
  against a tree from another directory reported "relations.json not found" even when
  the tree had one. The default is now `<tree>/relations.json`, then `./relations.json`:
  the declaration is the tree's own artifact, and a stale `./relations.json` cannot
  silently judge a different tree.
- **Declaration-scope host rules never ran.** `runRules` skipped every rule whose scope
  was `declaration`, so a `--rules` module's host/extra checks were silently ignored.
  `--rules` promises that host rules ADD findings; they now do, at every scope.
- **Residue `count` was always 1.** The dedupe short-circuited before the increment, so
  the residue list could not say how much work a field was. Counts are now occurrences:
  the reference deployment reports 16 fields over 49 occurrences.
- **`doctor` summarised trees it never judged.** With no declaration present it printed
  the summary and exited **0**; a malformed one reached `buildContext` and died with
  `decl.families.map is not a function`. It is the first verb a host runs, so a clean
  exit there is the most convincing silent pass of all. `doctor` now refuses with exit
  `2` when there is no declaration, reports a malformed one as `DECL` errors with exit
  `1`, and validates with the same rule set as `lint`.
- **`validateDeclaration` reported shape errors and then ran anyway.** It pushed
  `families MUST be an array` and carried on into the declaration-scope rules, turning
  its own named refusal into a raw `TypeError` at every call site. It now returns early
  once the shape is wrong.

### The drift gate compared keys, not meaning

`graph --against` keyed on `(family, field)` alone, so a declaration that retargeted an
edge at the wrong family - or flipped its `kind` - reported **"0 added, 0 removed"**
while the lint went on enforcing the wrong target. There is now a third category,
`changed`, carrying both sides. A target is compared as a **set**, because widening a
row to a union of families is a legitimate human refinement: the reference deployment
widens two rows to seven families, and a naive equality check would have cried wolf on
the only real tree. A union that *omits* the inferred target is still drift.

### Published numbers are measured, not remembered

The README advertised "61 declaration edges (49 inferred / 12 needing declaration)" and
the spec "344 edges / 14 residue" against a tree that measures **57 inferred / 16
residue / 73 declared**. Families and records were exact, which is how a stale number
survives review - most of the sentence is right.

- **`conformance/fixture/`** is a committed corpus, so the numbers this repo publishes
  can be reproduced by anyone with one command.
- **`scripts/check-docs.mjs`** measures it on every run and refuses when the generated
  README block disagrees. `--write` regenerates it.
- The reference deployment's own figures - which this repo cannot re-run - moved to
  [`labs/reference-deployment.md`](labs/reference-deployment.md) as a dated snapshot
  with its units named. Pinning a number you cannot check is how the drift started.
- The spec's units table was corrected to the measured reality and now states the
  identity that makes the numbers checkable: **57 inferred + 16 residue = 73 declared**.

### Tests that run the program, not just the library

Every prior test imported `src/` and called it directly. The CLI - where the root is
resolved, the declaration is found, arguments are parsed, and the exit code is decided -
was never executed. That is why a 0-edge clean pass survived.

- **`test/cli.mjs`** spawns the real binary over real bytes in temp dirs and asserts on
  stdout, stderr, and exit code: 46 checks covering the clean path, exit 1, exit 2, the
  contract root (too high, too low, empty, and the legal single-family and mixed-family
  shapes that must stay quiet), declaration precedence, `--json` shape, `--against`,
  `--rules` at declaration scope, and `doctor`'s refusal to summarise an unjudged tree.
- The suite is wired into `npm test` as step 5 of 6. Every check was mutation-tested:
  reverting the root guard fails 7 checks, reverting the host-rule fix fails 2,
  reverting tree-first declaration precedence fails 2, and making the union comparison
  strict fails 1.

### Documentation

- `docs/cli.md` gained **The contract root** and **The declaration** sections, naming the
  failure mode that used to be silent, and the `changed` drift category.
- SPEC section 1 now states that the root contract is *enforced*, section 8 enumerates
  the exit-2 usage class (it previously said "usage" without saying what counts) and
  documents `doctor --json`'s actual shape.

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
