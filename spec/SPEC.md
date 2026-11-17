# The tresridge spec, version 1

One relation grammar, many hosts. This document is normative for any host that keeps a tree of records which reference each other, and for anyone authoring a family or an edge.

**Revision history.** v1.0.0 froze the family table and the edge table against the reference deployment's production reality (Synmergia: 1097 records, 55 families, 344 edges, measured 2026-11-17). The frozen grammar is a *picture of what the corpus already does* - the id conventions, the reference fields, the resolution the loader and the docs already assume - not a redesign of them. Ordering rule: code first, spec formalizes after; nothing schema-changing is hidden on the host side.

**Schema base (verified 2026-11-17, the reference deployment's probe):** the corpus ships **1097 `.tres` records across 55 directories**; a convention-only resolver extracts **344 edges**, leaves **14 fields** with no target convention, and finds **6 dangling** targets. v1 formalizes that reality; hosts either already conform (Synmergia) or adopt it fresh.

## 1. Directory contract (all hosts)

```
<tree-root>/
  <family>/                     # one directory per family
    <id>.tres                   # filename IS the id (section 3)
  relations.json                # the declaration: families + edges (this spec's artifact)
```

**The contract root.** The lint/graph contract root is the **tree root** - the directory whose children are family directories - never one family directory itself. A host that mirrors this in its own CLI reference cites this section rather than restating it.

## 2. The family (frozen for v1)

A **family** is one directory of records bound to one schema. It is the unit that today is spelled several different ways (a sync category, a loader call, an authoring-table row, a site category). One record, read by all.

| Field | Rules |
|---|---|
| `key` | kebab-case string, MUST match its directory name (mismatch = load refuse, never silent success) |
| `schema` | the schema identity its records declare (a `class_name`, a type tag). MUST match the record's own; a mismatch is a load refuse |
| `idPrefix` | OPTIONAL string. The id stem (`npc_`), or empty for bare ids. When present, `filename` MUST carry it (section 3) |
| `filename` | MUST be `id` in v1 - the filename IS the id. This is the authoring law, made checkable |

**Receipts per frozen row.** Every row cites the engine evidence it mirrors, so "conforming to the spec" and "what one repo does" never blur. Engine: the reference deployment's probe, `scripts/tresridge_probe.mjs` @ 2026-11-17:

- `key` MUST match its directory — measured: 55 families, every directory named for its family. The one mismatch class found was four id-less `roots/*/environment.tres` collapsing on stem (fixed by path-keying).
- `schema` MUST match the record's — measured: 67 schemas carry a `class_name`; the record declares it via `script_class` in the `.tres` header.
- `filename == id` — measured: lint-enforced for the prefixed families; the id-less `roots/*` records are keyed by path, the one acknowledged exception.
- `idPrefix` — measured: the runtime registry reserves `itm_`/`skl_`/`zn_`/`qst_`/`fct_`; the authoring baseline mandates `item_`/`zone_`/`quest_`/`faction_`. **These two disagree, and v1 does not pick a winner** (section 10, MIGRATION-NOTE): the prefix is host-owned, and the spec records whatever the host ships.

## 3. The record (host-owned, with one shared law)

The body of a record is **host-owned in full**: its fields, its types, its values are the host's schema and never this spec's business. Exactly one law is shared:

> **The filename IS the id.** A record's identity is its filename stem. A record whose declared id disagrees with its filename is a load refuse, not a silent success.

This is the single fact every consumer (loader, docs, site, lint) needs and none of them may restate. Everything else about the record is the host's.

## 4. The edge (frozen for v1)

An **edge** is one field on a family's records that points at another family. It is declared **once**, per `(family, field)`, and read by everything.

| Field | Rules |
|---|---|
| `field` | the record field carrying the reference. For a `nested` edge, a path with `[]` into an array-of-dicts (`entries[].item_id`) |
| `target` | a family `key`, or `virtual` (section 5) |
| `kind` | one of `ref`, `refs`, `nested`, `virtual`, `literal` (section 5) |
| `required` | OPTIONAL boolean, default `true`. `true`: a dangling target is a refusal. `false`: acknowledged, never refused |

**Idempotence.** Two edges for the same `(family, field)` are a declaration error, refused at load - never a last-wins merge.

## 5. The five edge kinds (frozen for v1)

The four shapes that actually occur in the corpus, plus the escape hatch that keeps the undeclared-field refusal honest. Anything not expressible as one of these is a **refusal**, not a silent skip.

| Kind | Meaning | Example |
|---|---|---|
| `ref` | scalar id → one family | `giver_npc_id` → `npc` |
| `refs` | array of ids → one family | `required_quests` → `quests` |
| `nested` | path into an array-of-dicts | `entries[].item_id` → `items` |
| `virtual` | resolvable by pattern, no file | `book_<skill_id>_<tier>` → `skills` |
| `literal` | a `_id`-shaped field that is NOT a reference | `some_external_id` → declared, never resolved |

**`literal` is the honesty kind.** A field can end `_id` and not be an edge - an external system's key, a hash, a free-form tag. Without `literal`, the "every `_id` field is declared" norm would have to tolerate an unlisted class, and the norm would lose its teeth. A `literal` edge is declared and never resolved. Its presence is never a spec violation.

**`virtual` is pattern-resolved, not file-resolved.** A virtual target names a pattern (`book_<skill_id>_<tier>`) that a host service expands at runtime. The lint CONFIRMS the pattern is well-formed and that the referenced stems resolve where they can; it never runs the expansion. Receipt: the reference deployment's `book_akkan_rune_chain_legendary`, prose-only today and invisible to every other tool.

## 6. The resolution rule (inference, not the contract)

A single convention seeds a declaration:

> **The target family is the last family token in the field name, pluralised.**
> `giver_npc_id` → `npc` · `source_zone_id` → `zones` · `secondary_loot_table_id` → `loot_tables`

**This is INFERENCE.** It exists so that `tresridge graph` can derive a first-draft declaration from an existing tree, and so authoring stays pleasant. It is never the contract, and **a conforming lint MUST NOT infer at check time**: the declared graph is authoritative, and a check that guesses is exactly the brittle frame this spec exists to end. Measured residue on the reference deployment: the rule resolves 344 edges and leaves 14 fields to declare by hand.

## 7. Errors (nameable, instant)

A conforming lint refuses with a one-line error naming the record, the field, and the broken norm the moment it sees the violation. Never a deep stack trace and never silent success. The refusals that carry the spec:

| Refusal | Fires when |
|---|---|
| `undeclared-edge` | a field ends `_id`/`_ids` and no edge declares it, and it is not `literal` |
| `dangling-ref` | a declared edge names a target no record in the target family carries |
| `name-dir-mismatch` | a family `key` disagrees with its directory name |
| `filename-id-mismatch` | a record's declared id disagrees with its filename stem |
| `cycle` | a chain (`next_quest_id`, a gateway pair) returns to its start |
| `duplicate-edge` | two edges declare the same `(family, field)` |

`required: false` downgrades `dangling-ref` to a warning - the field is acknowledged, the target is not asserted. It never silences `undeclared-edge`.

## 8. The conformance CLI (the project's own artifact)

```
tresridge lint tree/                             # declared edges resolve; no undeclared _id; no cycles
tresridge lint tree/ --json                      # { schema, families, edges, violations }
tresridge graph tree/                            # emit the resolved graph (nodes + edges)
tresridge graph tree/ --against relations.json   # diff the inferred graph vs the declared one
tresridge doctor tree/                           # the full pass: lint + graph + orphans + cycles
tresridge new my-family                          # scaffold a conforming family + edge skeleton
```

The `graph` verb is the adoption on-ramp: it DERIVES `relations.json` from an existing tree, so a host starts from truth. Exit contract: `0` clean, `1` violations, `2` usage. The `--against` diff is the drift gate: it fails when the declared graph and the inferred graph disagree, so a declaration that has fallen behind the corpus is loud, not silent.

## 9. Lifecycle norms (all hosts)

- **Explicit declarations only.** An edge resolves because `relations.json` enumerates it. Inference seeds a declaration (`graph`); it never replaces one.
- **One source per concept.** The declaration is the only place an edge is stated. A consumer (loader, docs, site) reads it; no consumer restates it.
- **Refusals are additive.** A new family or edge never changes an existing record's verdict. A non-additive change carries a MIGRATION-NOTE (section 10).
- **Coverage is checked, not assumed.** Every `_id`-suffixed field on a family's records must be a declared edge or explicitly `literal`. This is what stops an undeclared field from accumulating.
- **`--against` in CI.** A host runs `graph --against relations.json` so the declaration cannot drift from the corpus without a red gate.

## 10. Versioning and the MIGRATION-NOTE convention

A non-additive change to the grammar MUST carry all of: a grammar-number bump on the declaration (`schemaVersion`); a `MIGRATIONS` row (one row per event: what changed, old shape, new shape, refusal wording); refusal wording on old shapes at the lint; and consumer receipts from every host that pins the spec. No migration execution at check time: the lint either reads a declaration or refuses. Additive rows - a new edge kind, a new host-owned family - never move the number.

## 11. Onboarding a host (a declaration, not a fork)

A new host joins by answering three questions, in order, never by forking the grammar:

1. **What are my families?** One row per directory of records: key, schema, id prefix. `tresridge graph` derives the first draft.
2. **What are my edges?** Run `graph`, accept or correct the inference, mark the residue `literal` where it is not a reference. The reference deployment's 14-field residue is the honest size of that step.
3. **What does run mean?** The host owns its substrate (a generated manifest, a language const, a database), its consumers, and its receipts. It inherits the standing refusals unchanged: no inference at check time, no undeclared edge, no silent dangling target.

A host that declares nothing new inherits the whole spec by conforming to `relations.json` alone.

## 12. Non-goals

- **No record registry or marketplace.** Distribution stays: git repos plus npm.
- **No schema system.** tresridge declares edges, not fields. The schema stays the host's.
- **No runtime loader.** The spec governs the declaration and the refusals; each host keeps its own loader and substrate.
- **No inference at check time.** The rule seeds a declaration; it never replaces one.
- **No cross-host graph merge in v1.** Each host's graph stands alone; remote graph sources may add later as an explicit additive version, never silently.
