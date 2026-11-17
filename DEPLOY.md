# DEPLOY.md - the release runbook

tresridge is a **synmergia project**. It ships one thing: the `tresridge` CLI on npm. There
is no site, no database, no key, and no server.

## 1. The release ladder

- **0.x.y** - the manual lane. A human runs `npm publish` from a clean `main`. There is no
  OIDC/tag automation at 0.x; the family's tag-driven ladder begins at 1.0.0, and tresridge
  is not on that ladder.
- **1.0.0+** - if it ever ships, it takes a tag `vX.Y.Z` and the governed release lane.

Publishing is **optional and synmergia-owned**. The standard is useful as a repo and a CLI
invoked from a checkout; npm is a convenience, not a dependency.

## 2. Before a cut

```
npm run check     # the battery + the drift gate
git status        # clean tree
```

`prepublishOnly` runs `npm run check`, so a cut cannot happen without it.

## 3. What is NOT part of this repo

- **No family registration.** tresridge is not a member of the struct family roster: it is
  not in govstruct's `registry.v1.json`, has no `members/tresridge.json`, and serves no
  family-domain site. It keeps the family *model* (this layout, the spec/labs/conformance
  split, the refusal battery) without joining the roster.
- **No `adapter/`.** There is no adapter directory in the family and none here.
- **No `packs/`.** tresridge has no extension surface. The family's `packs/` slot is a
  host-extension contract that a spec-only repo does not need.

## 4. CI

`.github/workflows/test.yml` runs `npm run check` on Node 20 and 22. The reference
deployment wires its own lane against a pinned commit; tresridge itself runs only the
battery and the drift gate.
