---
permalink: cli/
layout: default
title: The tresridge CLI
description: The lint, graph, doctor, and rules verbs - how a tree is read, how a declaration is derived, and how a dangling reference is refused.
nav_order: 2
---

# The tresridge CLI

tresridge is a zero-dependency lint you run from a checkout or from npm. It
ships four verbs: three read or judge a tree, and one prints the refusal
vocabulary. Exit contract: `0` clean, `1` violations, `2` usage.

```bash
npx tresridge lint <tree> [--decl <file>] [--rules <module>] [--json]
npx tresridge graph <tree> [--out <file>] [--against <file>] [--json]
npx tresridge doctor <tree> [--decl <file>] [--rules <module>]
npx tresridge rules [--json]
```

## The verbs

| verb | what it does |
| ---- | ------------ |
| `lint` | every declared edge resolves; no undeclared `_id`; no cycles. The verb CI calls. |
| `graph` | infer a first-draft declaration from the tree (writes a draft). |
| `doctor` | lint plus the graph residue, and a summary of what needs declaring. |
| `rules` | list the refusal vocabulary ([`spec/refusals.json`](https://github.com/dhaupin/tresridge/blob/main/spec/refusals.json)), one source. |

## The adoption on-ramp: `graph`

The adoption problem for any standard is describe everything first. `graph`
inverts it. The first command needs no declaration at all: it reads the tree and
derives the declaration from truth, so you start from what you have instead of a
blank page.

```bash
npx tresridge graph data/ --out relations.json
# 55 families, 1097 records, 57 edges inferred, 16 fields need declaring
```

The residue - the fields the resolution rule could not resolve - is printed as a
short, honest list: these need your call.

`--against <file>` turns `graph` into a drift gate. It diffs the declaration the
tree implies against a committed one and reports what was added or removed, so a
record that quietly stopped being referenced fails the build instead of shipping.

```bash
npx tresridge graph data/ --against relations.json
# graph --against: 0 added, 0 removed
```

## The verdict: `lint`

`lint` judges the tree against a declaration. A field that ends `_id` or `_ids`
and no edge declares is a refusal; a declared edge whose target no record carries
is a refusal; a scalar ref chain that returns to its start is a refusal. Each is
one line naming the record and the field, never a stack trace.

```bash
npx tresridge lint data/ --decl relations.json
# 0 violation(s), 0 warning(s)
```

`--json` returns the whole verdict as data: `{ families, records, edges,
violations, warnings }`.

## The summary pass: `doctor`

`doctor` runs `lint` and prints the graph residue beside it, so one command
answers both questions: what is broken, and what still needs declaring.

```bash
npx tresridge doctor data/ --decl relations.json
# 55 families, 1097 records
# edges inferred 57 | needs declaring 16 | declared edges 73 | violations 6
```

## The vocabulary: `rules`

The lint holds no refusals of its own. It is a pipeline over
[`src/rules.mjs`](https://github.com/dhaupin/tresridge/blob/main/src/rules.mjs),
and the shared vocabulary is `spec/refusals.json`, plain JSON so a non-JS host
reads what the JS lint reads. `rules` prints it.

A host extends the lint without forking the grammar: pass `--rules <module>`, a
module exporting `{ rules: [...] }`. Two laws bind a host rule - it may not
invent a code (the code must be in the vocabulary), and it may not weaken a
standing refusal (host rules add findings).

## Baselines: mitigations with teeth

A host that must ship with a known refusal records it, on the record, with a
reason and a clock. An expired baseline stops excusing (`baseline-expired`); an
unmatched one is reported (`baseline-unmatched`). There is no `--ignore`, no
`--force`, no inline suppression - a refusal is excused with a reason and a
clock, or it is not excused.

## What is not part of this tool

tresridge declares edges, not fields; it governs the declaration and the
refusals, not your loader. It is not a schema system, not a runtime, and not a
service. Distribution is git plus npm: no account, no signup, no telemetry.