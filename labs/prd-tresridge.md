# PRD: tresridge (the `.tres` relation standard)

**Status:** v0.1 - the first cut (2026-11-17) · Owner: dhaupin
**Role:** the relation arm. It owns the edge grammar and the resolution contract that any content graph exchanges under.
**Package:** `tresridge` @ 0.1.0 (node >=20, ESM, zero runtime deps). NOT yet on npm (`npm view tresridge` = E404); the 0.1.x manual publish is the one outstanding M0 item.
**Core law:** declare the edge, resolve or refuse. The edge declaration is the shared-facts column; everything else about a record is host-owned and never refused.
**Family:** the struct family - **govstruct** (govern), **packstruct** (spec), **memstruct** (memory), **gamestruct** (agents + a11y), **eyestruct** (watch), **poststruct** (audit), **prestruct** (SSR), **freestruct** (SSG). tresridge is the **relation arm**: it owns how records reference each other. The forges are **monoforge** and **coreforge**; **railyard** is the composer. The interop law: no host imports a sibling to check a sibling; it invokes the sibling's public CLI.

---

## 1. One-line pitch

**One relation grammar and one resolution contract, so a directory of records becomes a declared graph.** Families, edges, and one lint that refuses an undeclared or dangling reference at author time - in any host that keeps a tree of records.

## 2. Why it exists (the evidence, not the idea)

The reference deployment is Synmergia: **1097 `.tres` records across 55 families**, referencing each other constantly - a quest names an NPC, a recipe names items, a loot table names a currency, a gateway names two zones. The relations are real. They are also **undeclared**: they exist as conventions, rebuilt independently in at least three places that have already drifted.

1. **The knowledge is copied, and the copies forked.** A directory → schema → id mapping is rebuilt in three languages: a sync allowlist (a hardcoded 37-name array in `sync_godot_data.ts`), a loader wiring (`data_service.gd`, **42** hand-written `_scan_directory(dir, type)` calls), and prose rules (`data-authoring-baseline.md` §2, §4). The allowlist was wrong: it silently dropped **19 populated directories / 119 files** until 2026-11-17.
2. **Enforcement is a hand-written parser.** The gate is `test_data_naming_lint.gd` - **2272 lines** of bespoke regex, one hand-written scanner per relation (`_string_array_field`, `_dict_keys_field`, `_bracket_block`, `_quest_ids_in`, `_objective_regex`). Each new relation is another scanner. This is the brittle, manual frame: knowledge that should be *declared* is instead *guessed*, in code.
3. **Two registries contradict each other.** `id_registry.gd` reserves `itm_`/`skl_`/`zn_`/`qst_`/`fct_`; `data-authoring-baseline.md` §2 mandates `item_`/`zone_`/`quest_`/`faction_`. Both are "the law", neither is authoritative, and the registry is referenced by **zero** content paths.
4. **Real defects hide in the gaps.** A convention-only resolver (the probe, §9) extracts **344 edges** and immediately finds two defects nothing else caught: `currency_id` is written `"currency_gold"` by schemas and `"gold"` by every loot table (two incompatible conventions, and the existing integrity gate *accepts both* rather than declaring one - `test_content_ref_integrity.gd:85`), and a virtual id (`book_<skill_id>_<tier>`) lives only in prose, invisible to every tool.

**The xkcd-927 shape, inverted.** The answer is not a 56th bespoke scanner. It is a small frozen interchange - the edge declaration - plus a conformance lane that every host runs.

## 3. The layer trap

"What is a relation" is two questions, and conflating them is why the current frame is brittle:

- **the edge** - which field points at which family, and how it resolves;
- **the substrate** - where the graph lives and how it is walked (a GDScript const, a JSON manifest, a database).

tresridge splits the concern. The **edge grammar is the standard**; the substrate is the implementation's choice; the **resolution contract is where the semantics live**. tresridge does not compete with a schema system or a loader - it is the edge grammar that rides them.

## 4. Scope

**Standardized (v1, frozen):**

- the **family** record: `key`, `schema`, `idPrefix`, `filename`;
- the **edge** declaration: `field`, `target`, `kind`, `required`;
- the four **edge kinds**: `ref`, `refs`, `nested`, `virtual`;
- the **resolution rule** (§7);
- the **refusals**: an undeclared `_id` field, a dangling target, a cycle.

**Not standardized, ever at v1:** the record body and its values; the schema's field types; the family vocabulary (which families exist is the host's); the substrate (GDScript const, `.json`, a database, a directory walk).

## 5. What is general, what is the reference deployment

tresridge ships as a **general, MIT-licensed, zero-dependency spec plus a lint CLI**. Nothing in it knows the name "synmergia" or "creadev" - a family is a tree of records plus a declaration, and a third party points it at their own.

| Layer | General (ships to npm) | Reference deployment (Synmergia) |
|---|---|---|
| The edge grammar (family + edge tables) | the spec | the 55-family / 344-edge graph |
| The resolution rule (last family token, pluralised) | the spec | the `.tres` id conventions |
| The lint (`lint` / `graph` / `doctor`) | the tool | run in the game CI + the web build |
| The family vocabulary (`npc`, `zone`, `loot_table`, …) | config (data) | Synmergia's `game/data/` directory tree |
| The substrate (a GDScript const, a generated manifest) | the host's choice | `game/core/data/relations.gd` |
| The consumers (runtime loader, docs, Codex) | the host's | `data_service.gd`, the baseline, the Codex "Related" panel |

**The one-sentence test for every section below:** *would a stranger with their own tree of records be able to use this?* If a section only makes sense inside Synmergia, it belongs in the reference deployment, not the spec.

## 6. The edge grammar (frozen for v1)

A **family** is one directory of records bound to one schema. It is the unit that today is spelled four different ways (a sync category, a loader call, a baseline table row, a Codex category). One record, read by all four.

| Field | Type | Rules |
|---|---|---|
| `key` | string | kebab-case; MUST match its directory name (mismatch = load refuse, never silent success) |
| `schema` | string | the schema identity its records declare (a `class_name`, a type tag); MUST match the record's own |
| `idPrefix` | string | OPTIONAL; the id stem (`npc_`), or empty for bare ids |
| `filename` | string | MUST be `id` in v1 - the filename IS the id (the `data-authoring-baseline` §2 law, made checkable) |

An **edge** is declared once, per `(family, field)`, and read by everything.

| Field | Type | Rules |
|---|---|---|
| `field` | string | the record field carrying the reference |
| `target` | string | a family `key`, or `virtual` (see below) |
| `kind` | string | one of `ref`, `refs`, `nested`, `virtual` |
| `required` | boolean | OPTIONAL, default `true`. `true`: a dangling target is a refusal. `false`: acknowledged, never refused |

**The four edge kinds** - the shapes that actually occur in the corpus. Anything not expressible as one of these is a `refusal`, not a silent skip:

| Kind | Meaning | Example |
|---|---|---|
| `ref` | scalar id → one family | `giver_npc_id` → `npc` |
| `refs` | array of ids → one family | `required_quests` → `quests` |
| `nested` | path into an array-of-dicts | `entries[].item_id` → `items` |
| `virtual` | resolvable by pattern, no file | `book_<skill_id>_<tier>` → `skills` |

**Host-owned acknowledged keys.** Some hosts carry fields that merely *look* like edges. The spec acknowledges a fifth kind, `literal`, so a host can clear one explicitly - the alternative is the "no undeclared `_id`" refusal losing its teeth. A `literal` edge is declared and never resolved. Their presence is never a spec violation, and a future host naming a new kind extends the list in a patch revision, not a schema bump.

**Receipts per frozen row.** Every row cites the engine evidence it mirrors, so "conforming to the spec" and "what one repo does" never blur. Engine: the Synmergia probe, `scripts/tresridge_probe.mjs` @ 2026-11-17, 1097 records.

- `key` MUST match its directory — measured: 55 families, every directory named for its family; the one mismatch class found was four id-less `roots/*/environment.tres` collapsing on stem (fixed by path-keying).
- `filename == id` — measured: the `data-authoring-baseline` §2 law, lint-enforced for the prefixed families.
- `ref`/`refs` resolve — measured: **344 edges**, **6 dangling**.
- `nested` paths resolve — measured: `entries[].item_id` in 21 loot tables.
- `virtual` — measured: 1 instance (`book_akkan_rune_chain_legendary`), prose-only today.
- undeclared `_id` refuses — measured: **14 fields** with no declared target today.

## 7. The resolution rule (the one convention that survives)

The probe establishes that a single rule resolves most edges with no declaration:

> **The target family is the last family token in the field name, pluralised.**
> `giver_npc_id` → `npc` · `source_zone_id` → `zones` · `secondary_loot_table_id` → `loot_tables`

This is **inference, not the contract.** It exists to seed a declaration and to keep authoring pleasant. The declared graph is authoritative; the rule is how its first draft is generated. Measured residue: the rule resolves 344 edges and leaves **14 fields** that must be declared by hand.

## 8. Errors (nameable, instant)

A conforming lint refuses with a one-line error naming the record, the field, and the broken norm the moment it sees the violation: an undeclared `_id` field, a dangling target, a name/dir mismatch, a cycle. Never a deep stack trace, and never silent success. The three refusals that carry the whole spec:

- `undeclared-edge` - a field ends `_id`/`_ids` and no edge declares it (and it is not `literal`);
- `dangling-ref` - a declared edge names a target that no record in the target family carries;
- `cycle` - a chain (`next_quest_id`, a gateway pair) returns to its start.

## 9. The conformance CLI (the project's own artifact)

```
tresridge lint tree/                        # every declared edge resolves; no undeclared _id
tresridge lint tree/ --json                 # { schema, families, edges, violations }
tresridge graph tree/                       # emit the resolved graph (nodes + edges)
tresridge graph tree/ --against decl.json   # diff the inferred graph vs the declared one
tresridge doctor tree/                      # the full pass: lint + graph + orphans + cycles
tresridge new my-family                     # scaffold a conforming family + edge skeleton
```

The immediate payoff is the `graph` verb: it *derives* the declaration from an existing tree, so adoption starts from truth rather than a blank page. Exit contract: `0` clean, `1` violations, `2` usage.

The probe that proves the shape today is `scripts/tresridge_probe.mjs` in the reference deployment - 122 lines, zero dependencies, and it already extracts the whole graph and names every residue. The CLI is that probe with a declaration file and an exit contract.

## 10. Lifecycle norms (all hosts)

- **Explicit declarations only.** An edge resolves because the declaration enumerates it. No inference at check time - inference only *seeds* a declaration (`graph`), never replaces one.
- **One source per concept.** The declaration is the only place an edge is stated. A consumer (loader, docs, site) reads it; no consumer restates it. This is the law that makes the system self-maintaining.
- **Refusals are additive.** A new family or edge never changes an existing record's verdict. A non-additive change carries a MIGRATION-NOTE (§11).
- **Coverage is checked, not assumed.** Every `_id`-suffixed field in a schema must be a declared edge or explicitly `literal`. This is what stops an undeclared field from accumulating.

## 11. Versioning and the MIGRATION-NOTE convention

A non-additive change to the grammar MUST carry all of: a grammar-number bump; a `MIGRATIONS` row (what changed, old shape, new shape, refusal wording); refusal wording on old shapes at the lint; and consumer receipts from every host that pins the spec. No migration execution at check time: the lint either reads a declaration or refuses. Additive rows (a new kind, a new host-owned key) never move the number.

## 12. The family: who cites this spec

| host | role | how it uses the spec |
|---|---|---|
| **synmergia** | reference deployment | 55 families, 344 edges; the runtime loader, the authoring baseline and the public Codex all read the declaration |
| **packstruct** | spec sibling | a pack's `entry` is an edge (`ref` → the entry file); the same declare-or-refuse shape |
| **memstruct** | memory sibling | a record's `provenance` is an edge; tresridge is the graph layer memstruct records ride |
| **govstruct** | controller | a member's `companions` are edges; the roster is a graph |

The interop law that governs every crossing: **no host imports a sibling to check a sibling; it invokes the sibling's public CLI.** Prose law is poststruct's; pack shape is packstruct's; record shape is memstruct's; roster is govstruct's; **edges are tresridge's.** tresridge orchestrates none of it - it is the grammar they share.

## 13. Onboarding a host (a declaration, not a fork)

A new host joins by answering three questions, in order, never by forking the grammar:

1. **What are my families?** One row per directory of records: key, schema, id prefix. `tresridge graph` derives the first draft.
2. **What are my edges?** Run `graph`, accept or correct the inference, mark the residue `literal` where it is not a reference. The 14-field residue in the reference deployment is the honest size of that step.
3. **What does run mean?** The host owns its substrate (a GDScript const, a generated `.tres`), its consumers, and its receipts. It inherits the standing refusals unchanged: no inference at check time, no undeclared edge, no silent dangling target.

## 14. Milestones

- **M0 - spec text.** `spec/SPEC.md` plus README plus this PRD. **IN PROGRESS** - this PRD is the first cut; the frozen `SPEC.md` follows.
- **M1 - the probe becomes a CLI.** `lint` / `graph` / `doctor` over a declaration file, zero-dep, MIT. **PARTIAL** - the probe (`scripts/tresridge_probe.mjs`) proves the extraction and the residue; the declaration file and the exit contract are the remaining work.
- **M2 - conformance harness plus publish.** Fixture trees (one clean, one per refusal norm), npm publish, each host pins `tresridge@0.1`. **NOT STARTED.**
- **M3 - the reference deployment adopts.** Synmergia authors `game/core/data/relations.gd`, rewrites the 2272-line regex lint as assertions over the walker, and generates the authoring-baseline tables from the declaration. **DESIGNED** - see the reference deployment's `labs/prd-data-graph.md`.

## 15. Non-goals

- **No record registry or marketplace.** Distribution stays: git repos plus npm. No central signing service.
- **No schema system.** tresridge declares edges, not fields. The schema stays the host's.
- **No runtime loader.** The spec governs the declaration and the refusals; each host keeps its own loader and substrate.
- **No inference at check time.** The rule seeds a declaration; it never replaces one. A check that guesses is the brittle frame this spec exists to end.
- **No cross-host graph merge in v1.** Each host's graph stands alone; remote graph sources may add later as an explicit additive version, never silently.

## 16. Naming collisions (researched 2026-11-17)

- **`tresridge`** - zero matches on GitHub or the web. Free.
- **`ridge`** - appears in the reference deployment's corpus (19 files), but always as a *generic terrain noun* (`PEAK, # mountain, ridge, range`; "the mountain ridge to the east"). No service, schema, or spec owns it - unlike **Forge**, which is a named in-world concept (`forge_balance_data.gd`, a `FORGE` crafting enum, 61 files, and the story line *"Smiths wake the Forge"*).
- **The house fleet is the primary namespace:** a `struct`-suffixed spec plus a `ridge` metaphor (the raised spine connecting peaks - traversed to get from one place to another, which is what a graph is) is ours.

## 17. Docs and house onboarding

- **Docs system - the triple dogfood:** a `/docs` site built on Jekyll plus Pagefind plus Freestruct, with poststruct auditing the output. It is simultaneously the spec's documentation, freestruct's showcase, and poststruct's customer. Domain: `docs.creadev.org/tresridge`.
- **`/labs/TASKS.md`** - the own-runner convention.
- **`/horcrux/` plus the public brain** - `models/public/tresridge/` in the vant workspace; the boot stone lives in creadev.
- **Site:** `tresridge.creadev.org`, Cloudflare Pages (`wrangler.toml`, `functions/` with an `/api/health` canary). Docs via GitHub Pages plus Actions: Jekyll, then freestruct (basePath-aware), then pagefind, then the official artifact deploy.
- **The reference deployment's tie-together doc** lives with the deployment: Synmergia's `labs/prd-tres.md` is the adoption PRD that binds this spec to the game's 55 families, its loader, and its Codex.

---

## 18. Change Log

| Date | Author | Summary |
|------|--------|---------|
| 2026-11-17 | dhaupin + OpenHands agent | Initial creation (v0.1, the first cut). Core law: declare the edge, resolve or refuse. Frozen v1 grammar (family + edge tables, four edge kinds, the resolution rule), the general/reference split, the conformance CLI surface, and the four-step ladder. Evidence base is the reference deployment's probe: 1097 records, 55 families, 344 edges, 14 undeclared fields, 6 dangling. |
