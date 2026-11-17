# tresridge 0.1.0

The `.tres` relation standard. **One edge grammar + one resolution contract, many hosts**: a tree of records becomes a declared graph, and one lint refuses an undeclared or dangling reference at author time.

**Core law:** declare the edge, resolve or refuse. The edge declaration is the shared-facts column; everything else about a record is host-owned and never refused.

**New here?** Start with [`labs/prd-tresridge.md`](labs/prd-tresridge.md) - the product contract. It carries the frozen v1 grammar (family + edge tables, four edge kinds, the resolution rule), the general/reference split, and the conformance CLI surface.

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

```bash
npx tresridge lint <tree>                    # every declared edge resolves; no undeclared _id
npx tresridge lint <tree> --decl rel.json    # against a named declaration (default relations.json)
npx tresridge lint <tree> --json             # { families, records, edges, violations, warnings }

npx tresridge graph <tree>                   # infer a first-draft declaration from the tree
npx tresridge graph <tree> --out rel.json    # write the draft
npx tresridge doctor <tree>                  # the summary pass: families, edges, residue, violations
```

Exit contract: `0` clean, `1` violations, `2` usage.

The `graph` verb is the adoption on-ramp: it **derives** a declaration from an existing tree, so a host starts from truth instead of a blank page. The declared graph is authoritative; inference only seeds it.

## The resolution rule

A single convention resolves most edges with no declaration:

> **The target family is the last family token in the field name, pluralised.**
> `giver_npc_id` → `npc` · `source_zone_id` → `zones` · `secondary_loot_table_id` → `loot_tables`

This is **inference, not the contract** - it seeds a declaration. Measured on the reference deployment: the rule resolves **344 edges** and leaves **14 fields** to declare by hand.

## Status

**v0.1 - the first cut (2026-11-17).** The spec, the front door, and the CLI land together. The extraction is proven, and the tool now proves itself: the refusal battery observes every verdict from a real lint run and refuses its own run on dishonesty. Measured on the reference deployment: 55 families, 1097 records, 61 declaration edges (49 inferred / 12 needing declaration), 6 real dangling refusals.

**M0** spec text - *done* · **M1** the CLI (`lint` / `graph` / `doctor`) - *done* · **M2** conformance harness + npm publish - *partial* (battery + cases ship; publish pending) · **M3** the reference deployment adopts - *designed*.

## Family

tresridge is the **relation arm** of the struct family. Prose law is [poststruct](https://github.com/dhaupin/poststruct)'s; pack shape is [packstruct](https://github.com/dhaupin/packstruct)'s; record shape is [memstruct](https://github.com/dhaupin/memstruct)'s; the roster is [govstruct](https://github.com/dhaupin/govstruct)'s; **edges are tresridge's**.

The interop law that governs every crossing: **no host imports a sibling to check a sibling; it invokes the sibling's public CLI.** tresridge orchestrates none of it - it is the grammar they share.

## License

MIT. See [LICENSE](LICENSE).
