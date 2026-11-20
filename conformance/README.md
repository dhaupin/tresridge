# Conformance cases

Language-neutral cases any host runs through its own lint. Each directory is
one case: the tree bytes, the declaration, and the verdict the standard
requires. A host that agrees on every case is conforming.

A case's `expected.json` carries `violations` (the refusal codes, sorted) and
`warnings`. Codes are the SPEC section 7 names.

The reference implementation runs these as part of `npm test` (the refusal
battery in `labs/refusal-battery/` is the same idea in a flat, one-file-per-row
form; this directory is the on-disk tree form a host materializes directly).
