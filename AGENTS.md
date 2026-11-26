# AGENTS.md - tresridge

## Identity

- **Name:** tresridge (the `.tres` relation standard)
- **Repo:** dhaupin/tresridge
- **Core law:** declare the edge, resolve or refuse
- **Owner:** synmergia. tresridge is a **member of the struct family** (govstruct
  member `tresridge`, role `arm`) and the **first production consumer is synmergia**,
  the Godot MMORPG whose tree it was drawn from. Membership is a roster fact; the
  consumer is a deployment fact. Neither is inferred from the other.
- **Family arm:** tresridge speaks [packstruct](https://github.com/dhaupin/packstruct)
  v1 as both a HOST (it loads packs and runs their checks) and a PRODUCER
  (`packs/public/`). It is a `check`-profile host, so its packs are check packs.
- The grammar is a picture of what the reference deployment's tree already does
  (1097 records, 55 families), not a re-design of it.

## The two halves

tresridge is one repo with two halves, the shape coreforge itself runs (tool plus dogfood):

- **The tool** (`bin/`, `src/`, `spec/`, `packs/`) - the standard. This is the npm
  package. `npm run check:tool` is its battery.
- **The site** (`web/`, `docs/`, `site.config.js`) - a **coreforge rig**. The landing
  (prestruct React/Vite, prerendered) and the docs (Jekyll), driven from one identity
  file. `npm run site:check` / `site:sync` / `site:doctor`.

`npm run check` runs both. The site half is an ADOPTER of the family's site rig, not a
family membership: the rig is `coreforge`, the tool is ours.

## Mechanical conventions (this repo)

- `spec/SPEC.md` is normative; everything in `src/` and `bin/` implements it. A conflict
  between the two is a bug in `src/`, never a reinterpretation of the spec.
- The lint is STRICT against spec norms and only those norms. If a check would flag
  something the spec says is fine, fix the spec or the check: never ship a check the spec
  does not promise.
- **The lint NEVER infers at check time** (SPEC section 6). Inference lives in
  `src/graph.mjs`, which SEEDS a declaration; it never replaces one. A check that guesses
  is the brittle frame this project exists to end.
- **The lint holds no refusals of its own.** Every refusal lives in `src/rules.mjs`,
  the registry; `src/lint.mjs` is a facade over it. The vocabulary
  (`spec/refusals.json`), the registry, and the battery are ONE source, held together
  by `scripts/check-vocabulary.mjs` - it refuses an undocumented refusal, a promise
  with no check, an unproven refusal, or a section 7 table that drifted. Never add a
  refusal by editing the spec table: edit the vocabulary, then `vocab:write`.
- **Hosts extend by adding rules, never by forking.** `--rules <module>` (or
  `opts.extraRules`) for a one-off module, `--packs <dir>` (or `opts.packs`) for a
  packstruct pack. A host rule may not invent a code (it MUST be in the vocabulary it
  was handed) and may not weaken a standing refusal (rules ADD findings).
  `packs/public/` is the shape, and it is the same artifact the family ecosystem reads.
- **One manifest, two consumers.** A pack's `pack.json` is packstruct's (schemaVersion,
  name, version, description, entry) plus tresridge's own keys (`adds`, `vocabulary`).
  Never a second manifest beside it. A pack's `checks[]` ARE rules, and each carries
  `id` (the key packstruct's census reads) beside `code` (tresridge's name for it).
- **No suppression, ever.** There is no `--ignore`, no `--force`, no inline disable. A
  refusal is excused by a baseline with a reason and a clock (SPEC section 9), or not
  at all.
- **The tool carries its own battery.** `scripts/gen-refusal-matrix.mjs` materializes each
  fixture, runs the REAL lint over the bytes, and REFUSES ITS OWN RUN (exit 1) when any
  observed verdict disagrees with expectation. `labs/refusal-matrix.tresridge.json` is the
  committed column; `--check` is the drift gate. The same definitions emit
  `conformance/cases/`, so the flat battery and the tree form cannot drift apart.
- **Units are named.** "Edge" means a `(family, field)` declaration pair; a *reference
  instance* is one id value on one record. Never quote a count without its unit
  (SPEC section 2 carries the table).
- Fixtures under `conformance/cases/` carry the refusal each norm exists for. A new norm
  ships with a case that breaks it, or it is not a norm.
- **A clean exit over nothing is a bug, not a pass.** Every defect this tool has shipped was
  the same shape: exit 0 while measuring the wrong thing (a root above the tree root inferred
  0 edges; `doctor` summarised a tree with no declaration; `--against` compared keys and
  missed a retargeted edge). When you add a verb or a gate, ask what it does when it has
  nothing to judge, and make that exit `2`, never `0`.
- **Test the binary, not just the library.** `test/cli.mjs` spawns `bin/cli.mjs` over real
  bytes in temp dirs and asserts stdout/stderr/exit code. The library tests all passed while
  the CLI silently passed a 0-edge tree, because nothing ran the program. Mutation-test every
  guard: revert the fix, watch the suite fail, restore it. A check that cannot fail is not a
  check.
- **Published numbers are measured by a gate.** `scripts/check-docs.mjs` measures
  `conformance/fixture/` and refuses when the README block disagrees; `docs:write` regenerates
  it. Never hand-edit a count in the README or the spec table. A number you cannot re-run
  belongs in `labs/` as a dated snapshot with its units named.
- **Widening a declaration is not drift.** `diffDeclaration` compares targets as a SET: a
  union that contains the inferred target is a human refinement. Only an omission (or a kind
  flip) is drift. Do not "simplify" this to equality - the reference deployment widens two
  rows to seven families and would be reported as broken.
- The reader is host-neutral: `src/tres.mjs` knows nothing about any particular game's
  vocabulary. Do not put a rule in the standard that only one host can satisfy.
- Zero runtime dependencies. Node ESM. Exit codes 0/1/2.
- **Brand art is one master, and every mark derives from it.** `web/public/og-image-alt.jpg`
  is the art master. `web/public/icon.svg` and `docs/icon.svg` are byte-identical to each
  other, and both embed the master's mark as a base64 PNG rather than a vector trace - so
  the shipped icon is a raster and will not scale past its 128px source. The four PNG
  favicons are rendered from that same mark. `npm run og` redraws the social card,
  cropping the mark from the master (`--mark-art` + `--mark-crop l,t,w,h`), so the
  card is reproducible from committed bytes - check `sha256sum` before installing a
  regenerated card. `node web/scripts/adopt-icons.mjs` is the *vector* pipeline
  (potrace trace + iris geometry); it does **not** reproduce the shipped raster icon,
  and its accent mask is hardcoded to a blue hue so `--accent` only sets paint, not
  geometry - see coreforge#76 before trusting it for a warm accent. Those scripts need
  build-local helpers (`sharp`, `@resvg/resvg-js`, `dejavu-fonts-ttf`) installed with
  `npm i --no-save` **in one command** (a second no-save install prunes the first);
  none of them touch `package.json` or the lockfile.
- **Copy on the site is measured, never remembered.** Every number on the landing page
  (55 families / 1097 records / 57 inferred / 16 needing declaration) comes from
  `doctor --json` against the real consumer tree. Rendered claims are re-derived, not typed:
  the verb list is five (`lint`, `graph`, `doctor`, `rules`, `lint-packs`) and the edge kind
  list is five (`ref`, `refs`, `nested`, `virtual`, `literal`). Check `bin/cli.mjs --help`
  and `spec/SPEC.md` section 5 before editing either.
- Generated files never travel: `node_modules/`, `*.tgz`.

## Release

- 0.9.x is the manual lane (`npm publish` by a human). 0.9.0 shipped this way on
  2026-11-26 and is `dist-tags.latest`. This is a synmergia project: publishing is
  optional and synmergia-owned, never a family ladder.
- `packs/` is on coreforge's family-default forbidden list, so every `verify-release`
  invocation passes `--allow packs/` - the reference pack is a shipped artifact here,
  not a dev rig. Drop the flag and the ladder fails a clean cut with `FORBIDDEN
  contents in the tarball: packs/...`, including on the tag-triggered verify job.
- A manual cut carries no provenance attestation, and `verify-release --npm` asserts
  one. That is why `publish.yml` routes 0.x to the `--pack` ladder instead: the served
  bytes and integrity, minus the attestation this lane cannot produce.
- CHANGELOG.md is Keep-a-Changelog. The top section is the version actually on npm;
  an `[Unreleased]` heading over a released tree is a claim the gates do not catch.

## Branches

- `main` is the trunk (production). Work happens on `staging` (the preview/integration
  branch); promotion to `main` is the only path out, via a PR merged with a merge commit.
  `staging-ff-sync.yml` keeps staging a fast-forward mirror of main after each promotion.
- Automation is bound by the same rule, not exempt from it. `.github/dependabot.yml` sets
  `target-branch: staging` on every ecosystem: without it Dependabot opens on the default
  branch (`main`) and the update skips the one place it gets validated. Any future bot or
  generator that opens PRs needs the same line, or it is bypassing the flow by default.

## Family model (referenced, not joined)

- The conventions are borrowed from the struct family: [packstruct](https://github.com/dhaupin/packstruct)
  (the spec arm), [memstruct](https://github.com/dhaupin/memstruct) (the spec+handler
  sibling whose layout this repo mirrors), [govstruct](https://github.com/dhaupin/govstruct)
  (the roster - which deliberately does NOT list tresridge).
- The interop law: no host imports a sibling to check a sibling; it invokes the sibling's
  public CLI.
