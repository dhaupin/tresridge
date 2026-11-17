# tresridge 0.1.0

The `.tres` relation standard. **One edge grammar + one resolution contract, many hosts**: a tree of records becomes a declared graph, and one lint refuses an undeclared or dangling reference at author time.

**Core law:** declare the edge, resolve or refuse. The edge declaration is the shared-facts column; everything else about a record is host-owned and never refused.

**New here?** Start with [`labs/prd-tresridge.md`](labs/prd-tresridge.md) - the product contract. It carries the frozen v1 grammar (family + edge tables, four edge kinds, the resolution rule), the general/reference split, and the conformance CLI surface.

This repo ships the normative spec ([`spec/SPEC.md`](spec/SPEC.md)) plus a zero-dependency lint CLI that kills the worst relation-authoring class at author time: a field that points at a record which does not exist, or a `_id` field no one declared. Every host that keeps a tree of records uses the same core check.

## The edge grammar, in one screen

A **family** is one directory of records bound to one schema. An **edge** is one field that points at a family.

```
family  npc    { schema: "NpcData",   idPrefix: "npc_" }
family  quest  { schema: "QuestData", idPrefix: "quest_" }

edge    quest.giver_npc_id           -> npc    kind: ref
edge    quest.required_quests        -> quest  kind: refs
edge    loot_table.entries[].item_id -> item   kind: nested
edge    book.<skill>_<tier>          -> skill  kind: virtual
```

One record, read by every consumer - the runtime loader, the authoring docs, the public site. No consumer restates an edge.

## Usage

```bash
npx tresridge lint tree/                     # every declared edge resolves; no undeclared _id
npx tresridge lint tree/ --json              # { schema, families, edges, violations }

npx tresridge graph tree/                    # emit the resolved graph (nodes + edges)
npx tresridge graph tree/ --against decl.json   # diff the inferred graph vs the declared one
npx tresridge doctor tree/                   # the full pass: lint + graph + orphans + cycles

npx tresridge new my-family                  # scaffold a conforming family + edge skeleton
```

Exit contract: `0` clean, `1` violations, `2` usage.

The `graph` verb is the adoption on-ramp: it **derives** a declaration from an existing tree, so a host starts from truth instead of a blank page. The declared graph is authoritative; inference only seeds it.

## The resolution rule

A single convention resolves most edges with no declaration:

> **The target family is the last family token in the field name, pluralised.**
> `giver_npc_id` → `npc` · `source_zone_id` → `zones` · `secondary_loot_table_id` → `loot_tables`

This is **inference, not the contract** - it seeds a declaration. Measured on the reference deployment: the rule resolves **344 edges** and leaves **14 fields** to declare by hand.

## Status

**v0.1 - the first cut (2026-11-17).** The spec text and this front door land first; the frozen `spec/SPEC.md` and the CLI follow. The extraction is proven: the reference deployment's probe (`scripts/tresridge_probe.mjs`, 122 lines, zero deps) already walks 1097 records across 55 families and names every residue.

**M0** spec text - *in progress* · **M1** the probe becomes a CLI - *partial* · **M2** conformance harness + publish - *not started* · **M3** the reference deployment adopts - *designed*.

## Family

tresridge is the **relation arm** of the struct family. Prose law is [poststruct](https://github.com/dhaupin/poststruct)'s; pack shape is [packstruct](https://github.com/dhaupin/packstruct)'s; record shape is [memstruct](https://github.com/dhaupin/memstruct)'s; the roster is [govstruct](https://github.com/dhaupin/govstruct)'s; **edges are tresridge's**.

The interop law that governs every crossing: **no host imports a sibling to check a sibling; it invokes the sibling's public CLI.** tresridge orchestrates none of it - it is the grammar they share.

## License

MIT. See [LICENSE](LICENSE).
