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

The examples below use `npx tresridge`; until the package is published, run the
same lines as `node bin/cli.mjs` from a checkout.

```bash
npx tresridge lint <tree> [--decl <file>] [--rules <module>] [--json]
npx tresridge graph <tree> [--out <file>] [--against <file>] [--json]
npx tresridge doctor <tree> [--decl <file>] [--rules <module>]
npx tresridge rules [--json]
npx tresridge --version
```

The package is not on the registry yet, so `npx tresridge` does not resolve today.
From a checkout, substitute `node bin/cli.mjs` for `npx tresridge` in every line
above - same verbs, same exit codes, no install and no dependencies.

## The verbs

| verb | what it does |
| ---- | ------------ |
| `lint` | every declared edge resolves; no undeclared `_id`; no cycles. The verb CI calls. |
| `graph` | infer a first-draft declaration from the tree (writes a draft). |
| `doctor` | lint plus the graph residue, and a summary of what needs declaring. |
| `rules` | list the refusal vocabulary ([`spec/refusals.json`](https://github.com/dhaupin/tresridge/blob/main/spec/refusals.json)), one source. |

## The contract root

`<tree>` is the **tree root**: the directory whose children are family directories
(SPEC section 1). It is not your project root, and it is not one family directory.

```bash
npx tresridge graph .                    # WRONG: one "family" called `game`, 0 edges
# tresridge: not-a-tree-root: family "game" holds 1086 records across 70 directories
#   and 60 schemas - the root is above the tree root, so no edge can resolve
#   try: ./game/data
```

Getting this wrong used to be silent. Pointing at a project root collapsed every
record into a single family, so no `_id` field could ever match a target family: the
tool inferred **0 edges** and exited **0**, which reads as a clean tree. Pointing at a
family directory instead made every `.tres` its own family. Both now refuse with
`not-a-tree-root` and name the directory that does look like a root.

The two conditions are deliberately narrow, because a legal tree must never trip them:

- a root **above** the tree root fires only when one family spans several directories
  **and** several schemas. A mixed family is legal (SPEC section 2), so schema
  diversity alone is not evidence.
- a root **below** the tree root fires when family keys end in `.tres`, i.e. the
  root's children are records.

An empty directory refuses too (`empty-tree`): a clean verdict over zero records is
vacuous, and vacuous is the shape a silent failure takes.

## The declaration

`--decl` defaults to `<tree>/relations.json`, then `./relations.json`. The declaration
is the tree's own artifact, so `tresridge doctor data/` finds `data/relations.json`
from any working directory, and a stale `./relations.json` cannot silently judge a
different tree.

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
tree implies against a committed one and reports what was added, removed, or
**changed**, so a record that quietly stopped being referenced - or a row that
quietly points at the wrong family - fails the build instead of shipping.

```bash
npx tresridge graph data/ --against relations.json
# graph --against: 0 added, 0 removed, 0 changed
```

A `changed` row is one that exists on both sides but means something different:
the same `(family, field)` targeting another family, or carrying another `kind`.
Comparing only the pair was a hole - a declaration could retarget an edge at a
family that does not hold its ids, and the gate reported "0 added, 0 removed"
while the lint enforced the wrong target in silence.

Widening a row to a **union** of families is a legitimate human refinement, not
drift, so a union that contains the inferred target agrees with inference. A union
that omits it does not: the ids live somewhere the declaration will not look.

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

Output is capped at 20 findings per refusal code, with a line counting the rest;
`--all` prints every one and `--json` is always unbounded. The cap is per code,
so a rare refusal is never scrolled off by a common one.

## Scale

The tree is read once and held in memory, so cost is linear in records and in source
bytes. Measured on generated corpora, on four cores:

| corpus | records | source | wall | peak heap |
|--------|---------|--------|------|-----------|
| real tree (synmergia) | 1,097 | 1.0MB | 43ms | - |
| typical records | 100,000 | 78MB | 3.7s | 270MB |
| typical records | 743,403 | 553MB | 35s | 2.49GB |
| smallest records (46B) | 200,000 | 9MB | 57s | 223MB |
| large records (7.6KB) | 200,000 | 1.4GB | 108s | 4.92GB |

Cost is roughly `900 bytes x records + 3.3 x source bytes` of live heap. Both terms
matter: 46-byte records cost 24x their own size, because per-record overhead dominates
at that end, while field data dominates for large records. The reader estimates that
sum before parsing and refuses up front if it exceeds 95% of the heap, rather than
letting V8 abort. The difference is not cosmetic - a 1.35M-record tree that took 321s
to reach SIGABRT (exit 134, outside the 0/1/2 contract) is now refused in 14s with exit
`2` and the numbers that produced the refusal. Raise `--max-old-space-size` if you have
the headroom, or lint the tree in parts.

That 95% is deliberate. Shrinking the heap under a fixed 743k-record tree, it completes
at 88%, 92% and 95% of the limit (33-41s) and only aborts at 96-99% - so a guard set
well below the cliff would refuse trees that run fine. `TRES_MAX_RECORDS` still caps the
record count outright, for callers who want a fixed bound regardless of heap.

Parallelism does not help here, and this was measured rather than assumed. Async I/O
runs 3-4x slower than sync because the promise overhead per ~700B file exceeds the
read. Worker threads lose at two threads (0.84x) and worse beyond, because the
structured-clone payload costs more than the parse it saves. Read and parse are each
about 40% of the walk, and neither parallelizes cheaply at this file size.

## The summary pass: `doctor`

`doctor` runs `lint` and prints the graph residue beside it, so one command
answers both questions: what is broken, and what still needs declaring.

```bash
npx tresridge doctor data/ --decl relations.json
# 55 families, 1097 records
# edges inferred 57 | needs declaring 16 | declared edges 73 | violations 0
```

`doctor` refuses (exit `2`) when there is no declaration to judge against, and
reports a malformed one as `DECL` errors (exit `1`). It is the first verb a host
runs, so a summary over a tree it never judged would be the most convincing
possible silent pass. `--json` emits the same summary as data.

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