---
permalink: /
layout: default
title: tresridge docs
description: The .tres relation standard - declare the edge, resolve or refuse, and get the refusal at author time instead of in playtest.
nav_order: 1
---

# tresridge docs

Point tresridge at the tree you already have. It tells you what you have, what dangles, and what is undeclared, before you write a single declaration. One edge grammar and one resolution contract turn a directory of records into a declared graph, and one lint refuses a dangling or undeclared reference at author time.

**Core law:** declare the edge, resolve or refuse. The edge declaration is the shared-facts column; everything else about a record is host-owned and never refused.

The [CLI](/tresridge/cli/) page covers the verbs that read, derive, and judge a tree.

The package page is [npmjs.com/package/tresridge](https://www.npmjs.com/package/tresridge) (the 0.9.0 cut is staged for its first publish, so `npx tresridge` resolves once that lands).

## The one-line pitch

**Declare the edge, resolve or refuse.** A dangling id is not an error in most trees; it is a warning in a log nobody reads. tresridge moves that refusal from playtest to author time, with a filename.

## The resolution rule

A single convention resolves most edges with no declaration:

> The target family is the last family token in the field name, pluralised.
> `giver_npc_id` to `npc`, `source_zone_id` to `zones`, `secondary_loot_table_id` to `loot_tables`.

This is inference, not the contract. It seeds a declaration; the declaration is authoritative. Measured on the reference deployment, the rule resolves 57 of the host's 73 declared edge pairs and leaves 16 to declare by hand.

## Highlighting works out of the box

```js
// the lint holds no refusals of its own - it is a pipeline over the registry
const row = { code: 'dangling-ref', record: r.file, field: edge.field, target: v }
if (!resolves(edge.kind, edge.target, v, ctx.tree)) out.push(row)
```

```bash
# read a tree you never described, then judge it
npx tresridge graph data/ --out relations.json
npx tresridge lint data/ --decl relations.json
```

## The sidebar nav

Sidebar sections come from `docs/_data/nav.yml`: a list of groups, each with a `title` and an `items` list of `{title, url}` entries.
