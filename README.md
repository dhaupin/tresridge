# tresridge 0.9.0

The `.tres` relation standard. **One edge grammar + one resolution contract, many hosts**: a tree of records becomes a declared graph, and one lint refuses an undeclared or dangling reference at author time.

**Core law:** declare the edge, resolve or refuse. The edge declaration is the shared-facts column; everything else about a record is host-owned and never refused.

**New here?** Start with [`labs/prd-tresridge.md`](labs/prd-tresridge.md) - the product contract. It carries the frozen v1 grammar (family + edge tables, five edge kinds, the resolution rule), the general/reference split, and the conformance CLI surface.

This repo ships the normative spec ([`spec/SPEC.md`](spec/SPEC.md)) plus a zero-dependency lint CLI that kills the worst relation-authoring class at author time: a field that points at a record which does not exist, or a `_id` field no one declared. Every host that keeps a tree of records uses the same core check.

## The edge grammar, in one screen

A **family** is one directory of records. An **edge** is one field that points at a family — or at a **union** of families, when ids live across several directories (item ids sit in `weapons/`, `armors/`, `resources/`, ...).

```
family  npc    { schema: "NpcData",   idPrefix: "npc_" }
family  quest  { schema: "QuestData", idPrefix: "quest_" }

edge    quest.giver_npc_id           -> npc    kind: ref
edge    quest.required_quests        -> quest  kind: refs
edge    loot_table.entries[].item_id -> [weapons, armors, resources, ...]  kind: nested
edge    book.<skill>_<tier>          -> skill  kind: virtual
edge    npc_offering.service_id      -> (a class name, not an id)          kind: literal
```

One record, read by every consumer - the runtime loader, the authoring docs, the public site. No consumer restates an edge.

## Usage

From a checkout (works today - no install, no dependencies):

```bash
node bin/cli.mjs lint <tree>                    # every declared edge resolves; no undeclared _id
node bin/cli.mjs lint <tree> --decl rel.json    # against a named declaration (default relations.json)
node bin/cli.mjs lint <tree> --json             # { families, records, edges, violations, warnings }

node bin/cli.mjs graph <tree>                   # infer a first-draft declaration from the tree
node bin/cli.mjs graph <tree> --out rel.json    # write the draft
node bin/cli.mjs doctor <tree>                  # the summary pass: families, edges, residue, violations
node bin/cli.mjs rules                          # the refusal vocabulary this lint carries
node bin/cli.mjs lint <tree> --rules p.mjs      # add a host profile's rules
node bin/cli.mjs --version                      # the packaged version
```

Once the package is on the registry (see **Status** - it is not yet), every verb
above is also `npx tresridge <verb>`, and a host installs it with
`npm i -D tresridge`.

Exit contract: `0` clean, `1` violations, `2` usage.

The `graph` verb is the adoption on-ramp: it **derives** a declaration from an existing tree, so a host starts from truth instead of a blank page. The declared graph is authoritative; inference only seeds it.

## The resolution rule

A single convention resolves most edges with no declaration:

> **The target family is the last family token in the field name, pluralised.**
> `giver_npc_id` → `npc` · `source_zone_id` → `zones` · `secondary_loot_table_id` → `loot_tables`

This is **inference, not the contract** - it seeds a declaration. Measured on the committed fixture ([`conformance/fixture/`](conformance/fixture/)), which anyone can re-run, the rule resolves every edge it can and leaves the rest as named residue:

<!-- BEGIN GENERATED: fixture measurement -->

| the committed fixture | |
|---|---|
| families | 6 |
| records | 13 |
| edges inferred | 3 |
| residue fields | 2 |
| edges declared | 5 |
| edges resolved | 11 |
| violations | 0 |
| warnings | 0 |

<!-- END GENERATED: fixture measurement -->

Two residue fields survive: `npcs.class_id` and `npcs.book_id`. The first is a real reference the rule cannot guess (no `class` token in the field name resolves to `classes`); the second is a virtual key that is not a record id at all. Both are declared by hand in the fixture's `relations.json`, which is why the fixture lints clean.

## Enforcement is mechanical

A spec you do not enforce is prose. tresridge makes the definition and the enforcement the same source:

- **`spec/refusals.json`** is the shared refusal vocabulary - plain JSON, so a non-JS host reads what the JS lint reads.
- **`src/rules.mjs`** is the rule registry. The lint holds no refusals of its own; it is a pipeline over the registry.
- **`scripts/check-vocabulary.mjs`** is the gate. It refuses when the vocabulary, the registry, and the battery disagree in either direction - an undocumented refusal, a promise with no check, an unproven refusal, or a section 7 table that drifted from its data.

The SPEC's refusal table is **generated** from the vocabulary between markers. Editing it by hand is drift the gate catches.

### Baselines: mitigations with teeth

A host that must ship with a known refusal records it, on the record, with a reason and a clock:

```json
{ "code": "dangling-ref", "field": "currency_id",
  "reason": "gold resolves at load; tracked in SYN-4471", "expires": "2026-12-31" }
```

An expired baseline stops excusing (`baseline-expired`). An unmatched one is reported (`baseline-unmatched`). There is no `--ignore`, no `--force`, no inline suppression - a refusal is excused with a reason and a clock, or it is not excused.

### Extending without forking

A host adds rules, never edits the grammar. Two ways in, one law:

```
node bin/cli.mjs lint <tree> --rules ./my-rules.mjs      # a one-off module
node bin/cli.mjs lint <tree> --packs ./packs/public      # a packstruct pack, or a packs root
```

Two laws bind a host rule: it may not invent a code (the code MUST be in the vocabulary it was handed), and it may not weaken a standing refusal (host rules ADD findings).

A **pack** is the durable form: a directory with a `pack.json` and an entry module, per [packstruct](https://github.com/dhaupin/packstruct) v1. Its `checks[]` are rules, its `vocabulary` is merged before its rules are judged, and every finding it produces is stamped with the pack that made it. `packs/public/godot-shapes/` is the reference shape and it ships in this package; from a checkout, `node bin/cli.mjs lint <tree> --packs ./packs/public` is the whole install. (Once published, `npx tresridge lint <tree> --packs node_modules/tresridge/packs/public` is the same thing.)

`--packs` is repeatable, and a pack declaring a `requires` token the run root does not provide is skipped **by name**, never silently.

### Conformance: what tresridge claims, and what it declines

`packstruct audit-conformance` grades a host against the v1 cases. tresridge passes **10/10**. With `--claims` it reports **9/10**: the missing case is the env-claims echo, a surface for packs that declare environment claims. tresridge declines it rather than faking the echo, because no pack in the family declares env claims today - the pack layer was built for the cases that carry meaning here (manifest grammar, entry contract, id census, lifecycle, refusals by name), and an echo of nothing would be a claim with no bytes behind it. If a pack ever ships env claims, the echo becomes load-bearing and gets implemented then.

## The site (a coreforge rig)

This repo also ships its own front door: a landing site and a docs site at
`tresridge.creadev.org`, driven from one identity file. The rig is
[coreforge](https://github.com/dhaupin/coreforge) - the same tool-plus-dogfood shape the
family's sites run - adopted here, not vendored.

- **`site.config.js`** is THE identity: name, tagline, url, repo, maker, the docs block,
  the nav vocabulary, and the routes. The brand census gate refuses an identity literal
  anywhere else.
- **`npm run site:sync`** fans the identity out to the derived surfaces (the two engine
  configs, robots, the webmanifest). `--check` refuses drift, which is what CI runs.
- **`npm run site:check`** runs the gates; **`npm run site:doctor`** is the truth battery.
- The landing (`web/`) is a prestruct React/Vite prerender; the docs (`docs/`) are Jekyll.
  Both are gated in the same `test.yml` lane as the tool battery.

## Status

**v0.1 - the first cut (2026-11-17).** The spec, the front door, and the CLI land together. The extraction is proven, and the tool now proves itself: the refusal battery observes every verdict from a real lint run and refuses its own run on dishonesty. The numbers this repo publishes are measured from the committed fixture above, never remembered; the reference deployment's own figures are a dated snapshot in [`labs/`](labs/).

**M0** spec text - *done* · **M1** the CLI (`lint` / `graph` / `doctor`) - *done* · **M2** conformance harness + npm publish - *partial* (battery + cases ship; **the package is not on the registry yet**, so `npx tresridge` does not resolve - run it from a checkout, or see [`DEPLOY.md`](DEPLOY.md) for the manual first cut and the tag-driven OIDC lane that takes over at 1.0.0) · **M3** the reference deployment adopts - *designed* · **M4** the site rig (coreforge landing + docs) - *shipped in this branch*.

## Family model, not family membership

tresridge keeps the **struct family's model** - this layout (`spec/` + `labs/` + `conformance/` + `AGENTS.md` + `DEPLOY.md`), the refusal battery, the no-fiction generator, the named refusals, the 0/1/2 exit ladder. The conventions are borrowed from [packstruct](https://github.com/dhaupin/packstruct) (the spec arm) and [memstruct](https://github.com/dhaupin/memstruct) (the spec+handler sibling this repo's layout mirrors).

It is **not a member of the family roster**. tresridge is a **synmergia project**: it is not in [govstruct](https://github.com/dhaupin/govstruct)'s registry, has no `members/tresridge.json`, and serves no family-domain site. It keeps the model without joining the roster.

The interop law the family shares: **no host imports a sibling to check a sibling; it invokes the sibling's public CLI.**

## License

MIT. See [LICENSE](LICENSE).
