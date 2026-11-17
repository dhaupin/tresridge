# Contributing

## The gate

```
npm test        # the refusal battery, then the drift gate
npm run check   # test + the committed matrix matches a fresh run
```

Both must be clean. `npm test` refuses its own run when any observed verdict disagrees
with expectation, so a green run is a claim the tool has already proven.

## Rules

- `spec/SPEC.md` is normative. A conflict between it and `src/` is a bug in `src/`.
- The lint never infers at check time. Inference seeds a declaration in `src/graph.mjs`;
  it never replaces one.
- A new norm ships with a fixture in `labs/refusal-battery/` and a case in
  `conformance/cases/` that breaks it - both emitted from the same definition. A norm
  without a case is not a norm.
- Name your units. "Edge" is a `(family, field)` declaration pair; a reference instance is
  one id value on one record. A count without a unit will be refused in review.
- Zero runtime dependencies. Node ESM. Exit codes 0/1/2.

## Branches

`main` is the trunk. Branch off it, PR back to it.

## Versioning

Keep-a-Changelog. Every PR adds an `Unreleased` item. The pack semver rule does not apply
here - tresridge has no pack surface.
