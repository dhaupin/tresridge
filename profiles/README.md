# profiles/ - the extension surface

A **profile** is a named bundle of host rules plus a vocabulary extension. It is
how a family layers its own laws on the shared grammar without touching the
grammar: the grammar stays frozen, the profile adds checks.

## The shape

```
profiles/<name>/
  profile.json     the manifest: name, version, the codes it adds
  refusals.json    the codes this profile adds to the vocabulary
  index.mjs        the module: export const rules = [...]
```

A host invokes it:

```
tresridge lint <tree> --rules profiles/<name>/index.mjs
```

## The two laws (SPEC section 12)

1. **A profile may not invent a code.** Every code its rules emit MUST be in the
   vocabulary the host hands the lint. A code absent from the vocabulary is itself
   refused (`unknown-rule`). A profile ships its codes in its own `refusals.json`,
   which the host merges into the vocabulary it passes.
2. **A profile may not weaken a standing refusal.** Profile rules ADD findings.
   There is no hook that removes one. A refusal is excused only by a baseline
   (SPEC section 9) - on the record, with a reason and a clock.

## Reference

`profiles/godot/` is the reference profile: the checks the reference deployment
wants that are NOT general enough for the spec (a `_tres`-suffix convention, a
required `id` line on prefixed families). Read it as the worked example; copy it
as the starting shape for a new profile.
