# The tresridge spec, version 1

One relation grammar, many hosts. This document is normative for any host that keeps a tree of records which reference each other, and for anyone authoring a family or an edge.

**Revision history.** v1.0.0 froze the family table and the edge table against the reference deployment's production reality (Synmergia: 1097 records, 55 families, 344 edges, measured 2026-11-17). The frozen grammar is a *picture of what the corpus already does* - the id conventions, the reference fields, the resolution the loader and the docs already assume - not a redesign of them. Ordering rule: code first, spec formalizes after; nothing schema-changing is hidden on the host side.

**Schema base (verified 2026-11-17, the reference deployment's probe):** the corpus ships **1097 `.tres` records across 55 directories**; a convention-only resolver extracts **344 edges**, leaves **14 fields** with no target convention, and finds **6 dangling** targets. v1 formalizes that reality; hosts either already conform (Synmergia) or adopt it fresh.

**Units, named (this cost a whole session).** "Edge" was used for three different things and the numbers looked contradictory until they were separated:

| Unit | Count | Meaning |
|---|---|---|
| declaration edge | **61** | a distinct `(family, field)` pair - one row in `relations.json` |
| reference instance | **405** | one id value in one field on one record |
| inferred edge | **344** | reference instances whose field name resolves by the rule |

The 61 pairs split **49 inferred / 12 needing declaration**; the 405 instances split **367 resolved / 38 unresolved / 7 non-id** (PascalCase class names in `_id` fields, which are `literal`). Any host quoting a single number MUST name its unit.

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
| `key` | an identifier (its directory name). MUST match its directory name (mismatch = load refuse, never silent success) |
| `schema` | OPTIONAL. The schema identity its records declare (a `class_name`). Declaring one asserts every record carries it; a **mixed family** (the reference tree's `balance/` holds twelve) declares none, and the record's own schema stands |
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
| `target` | a family `key`, an **array of keys** (a union family - the reference tree's item ids live across `weapons/`, `armors/`, `resources/`, ...), or `virtual` (section 5) |
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

**`virtual` is pattern-resolved, not file-resolved.** A virtual edge declares a `pattern` (`book_<skill>_<tier>`) whose `<stem>` names a family via the declaration's `virtualFamilies` map. A host service expands the pattern at runtime, so no record carries the id; the lint does not run the expansion, it checks what it can see:

1. the value matches the pattern, and
2. every `<stem>` capture resolves as an id in its own family.

A stem is not delimited (`akkan_rune_chain` is one stem, not `akkan`), so the matcher backtracks over split points rather than assuming a length. A virtual edge with **no** `pattern` is refused (`unknown-rule`): without one, `virtual` would be a silent skip, which is the exact thing this spec exists to end. Receipt: the reference deployment's `book_akkan_rune_chain_legendary` (skills `akkan_rune_chain`, tiers `epic`/`legendary`), prose-only before and invisible to every other tool.

## 6. The resolution rule (inference, not the contract)

A single convention seeds a declaration:

> **The target family is the last family token in the field name, pluralised.**
> `giver_npc_id` → `npc` · `source_zone_id` → `zones` · `secondary_loot_table_id` → `loot_tables`

**This is INFERENCE.** It exists so that `tresridge graph` can derive a first-draft declaration from an existing tree, and so authoring stays pleasant. It is never the contract, and **a conforming lint MUST NOT infer at check time**: the declared graph is authoritative, and a check that guesses is exactly the brittle frame this spec exists to end. Measured residue on the reference deployment: the rule resolves 344 edges and leaves 14 fields to declare by hand.

## 7. Errors (nameable, instant)

A conforming lint refuses with a one-line error naming the record, the field, and the broken norm the moment it sees the violation. Never a deep stack trace and never silent success. The refusals that carry the spec:

<!-- BEGIN GENERATED: section 7 refusals -->
| Refusal | Severity | Spec | Fires when |
|---|---|---|---|
| `undeclared-family` | violation | 2 | a directory holds records but no family declares it |
| `name-dir-mismatch` | violation | 2 | a family key disagrees with the directory it is declared for |
| `schema-mismatch` | violation | 2 | a family declares a schema and a record in it carries a different one |
| `filename-id-mismatch` | violation | 3 | a record's declared id disagrees with its filename stem |
| `undeclared-edge` | violation | 7 | a field ends _id/_ids and no edge declares it, and it is not literal |
| `dangling-ref` | violation | 7 | a declared edge names a target no record in the target family carries |
| `cycle` | violation | 7 | a declared scalar ref chain returns to its start |
| `duplicate-edge` | violation | 4 | two edges declare the same (family, field) |
| `unknown-rule` | violation | 7 | a profile or baseline names a refusal code the vocabulary does not carry |
| `baseline-expired` | violation | 9 | a baseline's expiry has passed; the acknowledged refusal is no longer excused |
| `baseline-unmatched` | warning | 9 | a baseline excuses a refusal that no longer occurs; reported so it can be retired |
<!-- END GENERATED: section 7 refusals -->

**The vocabulary is the one source.** `spec/refusals.json` carries every code; `src/rules.mjs` implements every code; the battery exercises every code; and `scripts/check-vocabulary.mjs` refuses when any of the three disagree, in either direction. A code in the codebase but not the vocabulary is drift; a code in the vocabulary but not the codebase is a promise with no check; a code neither the battery nor a host case exercises is unproven. This is what makes "define it, enforce it" mechanical rather than aspirational.

`required: false` downgrades `dangling-ref` to a warning - the field is acknowledged, the target is not asserted. It never silences `undeclared-edge`.

## 8. The conformance CLI (the project's own artifact)

```
tresridge lint <tree> [--decl relations.json] [--json]   # refusals; exit 1 on any
tresridge graph <tree> [--out relations.json] [--json]   # infer a first-draft declaration
tresridge doctor <tree> [--decl relations.json]          # the summary pass
```

`lint` and `doctor` read a declaration (default `relations.json`); `graph` writes one. The
`--against <file>` drift verb diffs the inferred graph against the committed declaration and
fails (exit `1`) on drift, so a declaration cannot fall behind the corpus silently. Drift is
two-directional: `added` is an edge the tree has that no row names; `removed` is a row naming
an edge the tree no longer has. Two classes of row are exempt, because they are human
decisions rather than inference: a `literal` row (never inferred), and a row for a field in
`graph`'s residue (inference could not resolve it, so a human declared it).
The declaration itself is validated by the same rule set as the tree (`validateDeclaration`), so a malformed declaration refuses before a single record is read.

The `graph` verb is the adoption on-ramp: it DERIVES `relations.json` from an existing tree, so a host starts from truth. Exit contract: `0` clean, `1` violations, `2` usage. The `--against` diff is the drift gate: it fails when the declared graph and the inferred graph disagree, so a declaration that has fallen behind the corpus is loud, not silent.

## 9. Lifecycle norms, baselines, and enforcement

### Lifecycle norms

- **Explicit declarations only.** An edge resolves because `relations.json` enumerates it. Inference seeds a declaration (`graph`); it never replaces one.
- **One source per concept.** The declaration is the only place an edge is stated. A consumer (loader, docs, site) reads it; no consumer restates it.
- **Refusals are additive.** A new family or edge never changes an existing record's verdict. A non-additive change carries a MIGRATION-NOTE (section 10).
- **Coverage is checked, not assumed.** Every `_id`-suffixed field on a family's records must be a declared edge or explicitly `literal`.
- **`--against` in CI.** A host runs `graph --against relations.json` so the declaration cannot drift from the corpus without a red gate.

### Baselines (mitigations with teeth)

A host sometimes must ship with a known refusal it cannot fix yet. The spec allows this **on the record, never silently**. A **baseline** is a row in the declaration:

```json
{ "code": "dangling-ref", "record": "loot_tables/loot_bandit.tres", "field": "currency_id",
  "reason": "gold is a virtual currency resolved at load; tracked in SYN-4471",
  "expires": "2026-12-31" }
```

- `code` MUST be in the vocabulary (section 7) or the baseline is itself refused (`unknown-rule`).
- `reason` MUST be non-empty. A silent suppression is politeness theater; a baseline without a reason is refused.
- `record` and `field` are optional matchers; absent, the baseline matches any. Each may carry `*`/`?` globs, so one row excuses a class (`loot_tables/*.tres`) without listing every record.
- **A key the matcher does not read is refused** (`unknown-rule`). An ignored key - a typo'd `match` for `record` - would silently widen a narrow row into a catch-all, which is a suppression wearing a baseline's clothes. Allowed keys: `code`, `record`, `field`, `reason`, `expires`.
- **`expires` is the teeth.** An expired baseline stops excusing: the refusal returns, and the lint additionally reports `baseline-expired`. A mitigation with no expiry is a permanent hole; hosts MAY omit it only when the row carries a MIGRATION-NOTE.
- **An unmatched baseline is reported** (`baseline-unmatched`, a warning), so a stale excuse is visible and can be retired rather than quietly accumulating.

This is the difference between a baseline and a suppression: a suppression hides a refusal; a baseline *records* one, on the record, with an owner and a clock, and reports itself when it no longer applies.

### Enforcement is mechanical, not aspirational

"Define a structure, then enforce it" is only true if the definition and the enforcement cannot drift. tresridge enforces that with one gate, `scripts/check-vocabulary.mjs`, which refuses when:

| Drift | Meaning |
|---|---|
| a code in the registry but not the vocabulary | an undocumented refusal |
| a code in the vocabulary but not the registry | a promise with no check |
| a code neither the battery nor a host case exercises | an unproven refusal |
| the section 7 table disagrees with the vocabulary | the spec's prose drifted from its data |

The section 7 table is **generated** from `spec/refusals.json` between markers; editing the table by hand is drift the gate refuses. The vocabulary is JSON, so a non-JS host reads the same source the JS lint does.

## 10. Versioning and the MIGRATION-NOTE convention

A non-additive change to the grammar MUST carry all of: a grammar-number bump on the declaration (`schemaVersion`); a `MIGRATIONS` row (one row per event: what changed, old shape, new shape, refusal wording); refusal wording on old shapes at the lint; and consumer receipts from every host that pins the spec. No migration execution at check time: the lint either reads a declaration or refuses. Additive rows - a new edge kind, a new host-owned family - never move the number.

## 11. Onboarding a host (a declaration, not a fork)

A new host joins by answering three questions, in order, never by forking the grammar:

1. **What are my families?** One row per directory of records: key, schema, id prefix. `tresridge graph` derives the first draft.
2. **What are my edges?** Run `graph`, accept or correct the inference, mark the residue `literal` where it is not a reference. The reference deployment's 14-field residue is the honest size of that step.
3. **What does run mean?** The host owns its substrate (a generated manifest, a language const, a database), its consumers, and its receipts. It inherits the standing refusals unchanged: no inference at check time, no undeclared edge, no silent dangling target.

A host that declares nothing new inherits the whole spec by conforming to `relations.json` alone.

## 12. Extending the lint (the profile surface)

A host extends the lint by **adding rules**, never by forking it. `lint(tree, decl, { extraRules, vocabulary })` takes host rules; the CLI loads them with `--rules <module>`:

```js
// my-profile.mjs - a host's private rules
export const rules = [
  { code: 'my-project/no-empty-name', severity: 'violation', scope: 'tree',
    run(ctx) {
      const out = [];
      for (const r of ctx.tree.records) {
        if (/^name\s*=\s*""/.test(r.fields.get('name') || '')) {
          out.push({ code: 'my-project/no-empty-name', record: r.file, detail: 'name is empty' });
        }
      }
      return out;
    } },
];
```

Two laws bind a host rule:

1. **It may not invent a code.** The code MUST be in the vocabulary the host handed the lint. A host rule whose code is not in the vocabulary is itself refused (`unknown-rule`). To add a code, the host adds it to its own `refusals.json` - the vocabulary is data, so this is a data edit, not a fork.
2. **It may not weaken a standing refusal.** Host rules ADD findings. There is no hook that removes one; a refusal is excused only by a baseline (section 9), on the record, with a reason and a clock.

A **profile** is a named bundle of host rules plus a vocabulary extension, shipped as a module a host pins. The `profiles/` directory holds the reference shape. Profiles are how a family (a Godot project, a docs tree, a service config set) layers its own laws on the shared grammar without touching the grammar.

## 13. Transport and the independence boundary

tresridge is a **spec and its handler**, not a service. The relation it governs is data at rest - a declaration plus a tree - so the transport question is not "what protocol" but "what does a host exchange, and with what guarantee."

- **The unit of exchange is the declaration** (`relations.json`) and the **verdict** (`lint --json`). Both are plain JSON. Any host in any language can produce one and consume the other.
- **The verdict is a document, not a log.** `lint --json` emits `{ schemaVersion, families, records, edges, violations, warnings }` with stable codes from the vocabulary, so a consumer (a CI gate, a dashboard, another repo's doctor) reads a code, not a paragraph.
- **No network in the core.** The lint reads files and writes JSON. It opens no socket. A host that wants a fleet view composes verdicts; the composition is the host's, and a composer (a `govstruct`-shaped roll-up, a CI matrix) may exist without tresridge depending on it.
- **Independence.** tresridge may be embedded (import `src/lint.mjs`), invoked (the CLI), or reimplemented (the vocabulary and the conformance cases are language-neutral). A host that reimplements it passes `conformance/cases/` and is conforming; it need not depend on this repo at all.

**Non-goals for transport in v1:** no daemon, no server, no registry protocol, no live graph subscription. Distribution stays git plus npm (section 12).

## 14. Non-goals

- **No record registry or marketplace.** Distribution stays: git repos plus npm.
- **No schema system.** tresridge declares edges, not fields. The schema stays the host's.
- **No runtime loader.** The spec governs the declaration and the refusals; each host keeps its own loader and substrate.
- **No inference at check time.** The rule seeds a declaration; it never replaces one.
- **No cross-host graph merge in v1.** Each host's graph stands alone; remote graph sources may add later as an explicit additive version, never silently.
- **No suppression without a record.** There is no `--ignore`, no `--force`, no inline `# nolint`. A refusal is excused by a baseline with a reason and a clock, or it is not excused.
