# The reference deployment, measured

A dated snapshot of the host tree this repo cannot see. **Not gated** - nothing here
can be re-run by CI, so it must never be quoted as if it were a test result. The
figures this repo publishes live in the README block generated from
`conformance/fixture/`, which anyone can reproduce.

Kept because a host's real numbers are the evidence that the grammar fits production
data, and because the earlier drift (61/344/405 published against a 57/16/73 reality)
happened precisely because these figures had nowhere honest to live.

## 2026-11-17 - Synmergia `game/data/`

```
tree root:            game/data
families:             55
records:              1097
inferred edge pairs:  57
residue fields:       16  (49 record-field occurrences)
declared edges:       73
  by kind:            49 ref, 8 refs, 7 nested, 9 literal
resolved instances:   607
violations:           0
warnings:             0
```

Reproduce against a local checkout of the host:

```bash
npx tresridge doctor <host>/game/data
npx tresridge lint <host>/game/data --decl <host>/game/data/relations.json
```

## The check that these numbers are consistent

`57 inferred + 16 residue = 73 declared`, exactly. That identity is the point: the
inference and the host's hand-written declaration agree on every pair, which is why the
lint resolves 607 instances with zero refusals. A future measurement where the halves
do not sum to the declaration means either the declaration drifted from the tree (run
`graph --against`) or the inference rule changed.

## The root trap, observed

The same host, addressed one level too high:

```
tree root:            <host>            (WRONG)
families:             1  ("game")
records:              1097
inferred edge pairs:  0
exit:                 0                (before the not-a-tree-root refusal existed)
```

Every record landed in one family, so no field could resolve to a target family and
nothing could ever match. `tresridge graph <host>` now exits 2 and names
`<host>/game/data`.
