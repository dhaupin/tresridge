# labs/TASKS.md - tresridge work log

> Rolling log. Companion to [`labs/prd-tresridge.md`](./prd-tresridge.md) (the product contract). Newest session at top. Struck items are done.

Last updated: 2026-11-20.

## Session 2026-11-20 (a) - the staging branch, and the two promotions

The family flow was declared here (AGENTS.md section Branches) but not wired: there
was no `staging` branch, so the documented path had nowhere to run. This session made
the declaration true.

**`staging` exists.** Created at `main` (`f30b4b1`), the permanent integration branch.
PR #1 was retargeted from `main` to `staging` and merged as a merge commit (`12639c8`).
That is the first time the standard and the site rig landed through the integration
branch instead of straight onto the trunk.

**First promotion** (`staging` -> `main`, PR #2, merge `8a2fc80`). Both lanes green on
`staging` before the promotion: `test` and `Deploy Docs`. After the merge the
`staging-ff-sync` job fast-forwarded `staging` to `main`, so the two are equal again.

**Dependabot was bypassing staging.** The stamped `.github/dependabot.yml` had no
`target-branch`, so every update opened on the default branch, `main`, which skips the
one place the family flow says a change is validated. PR #3 (the github-actions group
bump) arrived that way and was retargeted by hand. The cause is now fixed: all three
ecosystems (`npm` at `/`, `npm` at `/web`, `github-actions`) name `staging`, and the
header comment records why so a re-stamp does not drop the line again (PR #4, merge
`af26210`). This matches `dhaupin/synmergia`, which already names `target-branch`.

**Second promotion** (`staging` -> `main`, PR #5, merge `46db9d7`). Lands the
dependabot fix plus the group bump: `freestruct` docs lane `7dfb172` -> `cd2536b`
(verified a strict descendant, 24 ahead, 0 behind) and `ruby/setup-ruby` v1.335.0 ->
v1.338.0. Still SHA-pinned, never floating. `main` and `staging` are equal at
`46db9d7`.

**One real finding: the docs deploy cannot publish.** `test` is green on `main`, and
the docs lane's `build` job is green, but its `deploy` job fails with a 404 from
`actions/deploy-pages`: "Ensure GitHub Pages has been enabled". The repository is
private and Pages has never been enabled on it (`private=true`, `has_pages=false`).
Every sibling that publishes docs is public (`synmergia`, `freestruct`, `coreforge` are
all `private=false`, `has_pages=true`); `creadev` is private and also has no Pages, so
this repo matches the private-repo pattern rather than a one-off break.

What is not established: whether Pages is *available* here or merely *unconfigured*.
The CI token cannot read the Pages settings or create them (both return 403 "Resource
not accessible by integration"), and the account plan reads as `none`, which is the
token declining to report rather than a real answer. So the cause is narrowed to
"Pages is off for this repo" and no further.

The caller is correct, the lane is correct, and the artifact uploads cleanly. This is
an owner action, not a repo-file one: enable Pages for the repo (Settings -> Pages,
source = GitHub Actions) if the plan allows it, or drop `docs-deploy.yml` from `main`
until it does. Left as found rather than papered over with a green-looking skip,
because a deploy that silently does nothing is the exact failure this repo's gates
exist to catch.

## Session 2026-11-17 (d) - the marketing PRD (audience-first, receipts-first)

The user's frame, and it reframes the whole project: "this isn't necessarily what
you or I want. It's what's best for folks with scattered tres, so we can help them
become orderly and logical, sanity again." That is the marketing brief. The subject
is not tresridge's adoption; it is the developer's sanity.

**`labs/prd-marketing.md`** - audience-first, in the house voice (dense, receipts for
every claim, honest non-goals):

- **The audience, named:** "the scattered tree" - a content directory grown one record
  at a time, conventions not declarations, references as unchecked strings, a lint
  nobody dares touch. The reference deployment is this condition, measured.
- **The pain, in the user's own words:** five sentences they already say, all traced to
  one root - *the system's default is silence* ("Godot loaded it fine").
- **The wedge:** `graph` on a tree you never described. Zero commitment, immediately
  useful, no declaration required. The user gets their graph before they get a standard.
- **Claims with receipts.** Every claim cites a measurement; a claim with no receipt is
  cut. The meta-claim is the best one: our own tooling is held to the discipline we sell
  (the vocabulary gate is a CI step, not a slogan).
- **Honest non-claims:** not a schema system, not a loader, not a platform, not a
  refactor, not family membership.
- **Sanity, not stars.** The leading success signal is the dangling count on a new
  user's first run. If it is zero for most trees, the wedge is wrong and we should say so.

**Four fictions caught while writing it** (the doc is itself held to its own rule):

1. Cited "73 edges drafted, 14 fields need declaring" - the measured values are **57
   inferred, 16 need declaring**. Fixed.
2. Cited "344 edge instances" from the probe - my tool measures 405 declared instances
   (373 resolving, 32 literal) because the probe used a convention-only count. Removed
   the unit ambiguity rather than pick a number that flatters.
3. Wrote a ten-minute script claiming `doctor` prints violations with **no declaration**.
   Ran it: `doctor` without a declaration reports the residue and says "declaration not
   found"; only `lint` judges. Rewrote the script to the verified flow.
4. Shipped `npx tresridge` in the script while the package is **not on npm** (M2
   pending). Added the publication-status note so the page cannot promise a 404.

## Session 2026-11-17 (c) - M2: the spec becomes checkable (enforcement + extension)

The user's frame: "once we define a structure, we have to enforce it - what better
way than an npm spec... concentrate on the spec/lint and extendability." The first
cut failed that test in a way worth naming: the refusals were **hardcoded inline** in
`lint.mjs` while the spec promised them in a table, and the two had already drifted.

**The four drifts found (all real, all silent):**

| Drift | Direction |
|---|---|
| `undeclared-family` | in the code, NOT in the spec table |
| `schema-mismatch` | in the code, NOT in the spec table |
| `name-dir-mismatch` | in the spec table, NOT implemented |
| `filename-id-mismatch` | in the spec table, NOT implemented |

A spec whose table and code can disagree is prose, not enforcement. So the refusals
became data and the drift became impossible.

**What landed:**

- **`spec/refusals.json`** - the shared vocabulary. Plain JSON, so a non-JS host reads
  what the JS lint reads. Eleven codes, each with severity and spec section.
- **`src/rules.mjs`** - the rule registry. `src/lint.mjs` is now a facade; the lint
  holds no refusal of its own. `runRules()` is a pipeline; `validateDeclaration()` runs
  the `declaration`-scope entries.
- **`scripts/check-vocabulary.mjs`** - the gate. Refuses, in either direction: a code in
  the registry but not the vocabulary; a code in the vocabulary but not the registry; a
  code the battery never exercises; a section 7 table that disagrees. `--write`
  regenerates the table between markers.
- **Baselines (mitigations with teeth).** A refusal can be excused on the record, with a
  non-empty reason and an optional expiry. Expired -> `baseline-expired` (the refusal
  returns). Unmatched -> `baseline-unmatched` (retire it). There is no `--ignore`,
  `--force`, or inline disable anywhere.
- **The extension surface.** `--rules <module>` on the CLI, `opts.extraRules` in the
  API, a `rules` verb to print the vocabulary. Two laws: a host rule may not invent a
  code, and may not weaken a standing refusal. `profiles/godot/` is the reference.
- **SPEC sections 9 (baselines + enforcement), 12 (extending), 13 (transport), 14
  (non-goals).** Section 13 states the independence boundary: the unit of exchange is
  the declaration and the verdict, both plain JSON; no network in the core; a host may
  embed, invoke, or reimplement.

**Two bugs the new rules found in the tool itself, on the real tree:**

- `filename-id-mismatch` fired 149 times because it ignored `idPrefix` - the filename is
  `prefix + id` (`achievement_bloom_contained.tres` carries id `bloom_contained`). Fixed,
  and `graph` now infers the prefix. 149 -> 0.
- The baseline filter collected `expired` notes but never returned them, so
  `baseline-expired` vanished. The battery refused the run and caught it.

**The honest result.** With the enforcement layer live, linting the reference tree still
yields **the same 6 violations, zero false positives** - and the two newly-implemented
rules stayed silent, because the corpus is genuinely clean there. Battery 10 -> 15 rows,
all observed honest. `npm run check` is now battery + drift gate + vocabulary gate.

## Session 2026-11-17 (b) - M1 lands: the probe becomes a tool that proves itself

The CLI is real: `bin/cli.mjs` + `src/{tres,lint,graph}.mjs`, zero runtime deps. The
family's refusal-battery pattern is adopted in full - `labs/refusal-battery/<id>.json`
(portable fixtures), `scripts/gen-refusal-matrix.mjs` (the no-fiction generator, which
**refuses its own run** when any observed verdict disagrees with expectation), and
`labs/refusal-matrix.tresridge.json` (the column, observed never hand-derived). The same
definitions emit `conformance/cases/` in on-disk tree form, so the two forms cannot drift.

**Ten battery rows, all observed honest:** clean, undeclared-edge, dangling-ref, literal-ok,
literal-keeps-teeth, schema-mismatch, undeclared-family, cycle, required-false-warns,
duplicate-edge.

### What the reference tree taught the spec (each was an invention, now measured)

Running the new lint over Synmergia's 1097 records refused three of the spec's own rules.
All three were fixed in `spec/SPEC.md`, not worked around:

1. **"edge" was three different units.** 344 (reference *instances* the rule resolves), 61
   (declaration *pairs*), 57 (pairs the draft inferred). The numbers looked contradictory
   until separated; SPEC now carries a **units table** and any host quoting a number must
   name its unit.
2. **A family is not one schema.** `balance/` holds twelve. `schema` is now OPTIONAL and
   advisory; a mixed family declares none.
3. **`target` must allow a union.** Item ids live across `weapons/`, `armors/`,
   `resources/`, ... so `target` may be an **array of keys**. Without this, every
   `loot_tables.item_id` read as dangling - a false positive.
4. **`key` is not kebab-case.** The reference tree's directories are snake_case
   (`loot_tables`). The kebab rule was invented and immediately refused.
5. **An id is lowercase-led.** `"BlacksmithService"` in `service_id` is a class name, not
   an id; counting it as a reference was a measured false positive. This is what the
   `literal` kind is for.

### The two bugs the tool had (both caught by running it on real data)

- The cycle detector followed the *declaring* family instead of the edge's *target* family,
  inventing a self-cycle for `npc.model_id`.
- The extractor counted PascalCase class names as id references.

### The honest result

With those fixed, linting the real tree yields **6 violations, zero false positives** - and
they are the true defects: five `loot_tables.currency_id -> "gold"` (the record is
`currency_gold`, the tables write `gold`) and one `loot_tables.item_id ->
"book_akkan_rune_chain_legendary"` (a *virtual* id; the skill file is
`akkan_rune_chain.tres`). Two independent implementations - the probe and this tool - agree
on the count.

### Open

- [ ] M1: the `--against` drift verb (diff inferred graph vs committed declaration; CI gate)
- [ ] M1: `nested` path resolution (`entries[].item_id`) - the kind is declared, the resolver is not yet written
- [ ] M2: npm publish (name verified free: `npm view tresridge` = E404)
- [ ] M2: wire `npm test` into a GitHub Actions workflow
- [ ] M3: the reference deployment authors `game/core/data/relations.gd` and rewrites its 2272-line regex lint as assertions over this walker
- [ ] docs: the `/docs` site and `tresridge.creadev.org`

## Session 2026-11-17 (a) - the first cut (M0)

- The repo opens with the normative spec ([`spec/SPEC.md`](../spec/SPEC.md)), the front door
  ([`README.md`](../README.md)), and the product contract ([`labs/prd-tresridge.md`](./prd-tresridge.md)).
- Core law fixed: **declare the edge, resolve or refuse.** The edge declaration is the shared-facts column; the record body stays host-owned.
- Frozen v1 grammar: the family table, the edge table, and five edge kinds (`ref`, `refs`, `nested`, `virtual`, `literal`). The fifth is the honesty kind.
- The resolution rule is fixed as **inference, not contract**: it seeds a declaration and MUST NOT run at check time.
- Name checked for collisions: `tresridge` free; `ridge` is a generic terrain noun in the reference corpus, not a named concept (unlike Forge).
