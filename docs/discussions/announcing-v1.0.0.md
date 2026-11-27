---
permalink: discussions/announcing-v1.0.0/
layout: default
title: Announcing tresridge v1.0.0
description: The grammar is frozen at SPEC v1, the release lane carries provenance attestation, and the cycle rule stops depending on array order.
version: 1.0.0
---

# Announcing tresridge v1.0.0

`tresridge@1.0.0` is on npm, and it is the first cut that is both governed and attested. The grammar is frozen: SPEC v1 is the contract a host can build against without expecting the shape of a declaration to move under it. The tarball carries a SLSA provenance attestation, which the 0.9.0 cut could not.

That attestation is the release-lane change, not a badge. v0.9.0 was published by hand, because npm's OIDC Trusted Publishing lane cannot be the first publisher of a package name. This cut goes through that lane, so the artifact is signed by the workflow that built it and a consumer can verify where the bytes came from.

## What changed

Three fixes, and each one closes a way the lint could disagree with the spec.

**The cycle rule follows a chain, not one hop.** It read only the first value of a multi-valued field and the first matching family of a union target, so a cycle reached through any other value was invisible. It now walks the reference chain to a fixed point and reports the loop, which is what SPEC section 7 always described. Two conformance cases hold this: `cycle-across-families`, and `cycle-same-id-across-families`.

**Order no longer decides a cycle verdict.** `cycle` read the first id of a field while `dangling-ref` in the same module judged every id. So `zone_id = ["zn_a", "zn_x"]` reported a loop and `["zn_x", "zn_a"]` - the same loop - reported nothing. The walk now branches over every id. On the reference deployment this was latent: 0 multi-valued `ref` fields across 1097 records, and the verdict there is unchanged at 0 violations over 2215 edges.

**`graph --against` accepts the answer.** The residue list names fields inference could not resolve, so a human can declare them. Once declared, the row was still counted as a removal, which meant the list could never shrink and no honest declaration satisfied the drift gate: a tree with 25 declared probable fields reported 26 phantom removals. A declared probable field is now the answer to the row, not drift. The exemption is computed from the evidence, so a declaration pointing somewhere the evidence does not support is still reported.

## The numbers, measured

Every figure below came from a run against the installed package, not from memory.

The committed fixture in `conformance/fixture/` measures 6 families, 13 records, 3 edges inferred, and 2 fields needing declaration. It lints clean: 0 violations and 0 warnings over 11 resolved edges. `npm run docs:check` re-measures that block on every run and refuses drift, which is why the numbers here can be trusted to still be true.

The tarball is 18 files. It carries `bin/`, `src/`, `spec/`, and the reference pack at `packs/public/godot-shapes/`, including the coverage fixture that `lint-packs --deep` requires. A clean install answers `--version` with `1.0.0`, and `lint-packs --deep` on the installed pack reports 1 pack checked, 0 violations. The refusal vocabulary is 15 codes, and `rules --json` prints all of them with a count.

## Adopting it

```bash
npx tresridge doctor <tree>            # what you have
npx tresridge graph <tree> --out relations.json   # a first-draft declaration
npx tresridge lint <tree>              # judge it
```

The law is unchanged and it is still one line: declare the edge, resolve or refuse. A dangling id is a warning in a log nobody reads at playtest time; tresridge moves that refusal to author time and names the file. A host that wants its own law adds rules with `--rules <module>` or a pack with `--packs <dir>`.

## What 1.0.0 promises

The grammar is frozen, not the tool. A declaration written against SPEC v1 keeps its meaning across 1.x, and a refusal code keeps its meaning too. What may still change is everything around that: new rules, new pack surfaces, and fixes to how an existing rule walks a tree - the three above are exactly that kind of change, and none of them altered what a valid declaration means.

## Getting it

```bash
npx tresridge --version     # 1.0.0
npm i -D tresridge
```

Source, spec, and the refusal vocabulary live at [github.com/dhaupin/tresridge](https://github.com/dhaupin/tresridge). The spec in `spec/SPEC.md` is the normative source; the CLI implements it.
