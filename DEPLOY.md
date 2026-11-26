# DEPLOY.md - the release runbook

tresridge is a **synmergia project**. It ships two things: the `tresridge` CLI on npm, and the
landing plus docs site at `tresridge.creadev.org` / `docs.creadev.org/tresridge`. There is no
database, no key, and no server.

The site half is a **coreforge rig** (see `site.config.js`): one identity file, a `sync` verb
that fans it out, and a brand census that proves no identity literal hid anywhere else. The
tool half is the standard itself (`bin/`, `src/`, `spec/`), unchanged by the rig.

## 1. The release ladder

- **0.x.y** - the manual lane. A human runs `npm publish` from a clean `main`; the OIDC lane
  refuses to be the *first* publisher of a 0.x. Once the registry serves that version, a
  `vX.Y.Z` tag runs `publish.yml` for the release object and the verify ladder, so a 0.x cut
  is still proof-carrying. The lane never publishes a 0.x itself.
- **1.0.0+** - takes a tag `vX.Y.Z` and the full governed lane: OIDC publish, release, verify.

The order for a 0.x cut is therefore **publish, then tag**:

```
npm run check            # the battery (prepublishOnly runs it again)
npm publish              # from a clean main, as a human
git tag v0.9.0 && git push origin v0.9.0
```

### The ship lane (publishing from a downloaded zip)

The first push of a new package name cannot use OIDC: npm Trusted Publishing is
configured per existing package, so the very first publish has to be a human with
a token. `scripts/ship-from-download.cjs` is that lane, scripted. It exists because
a GitHub zip carries no `.git` and no `node_modules`, and on a phone the download
folder is a FUSE mount that refuses the symlinks an install needs.

```
NPM_TOKEN=<granular publish token> npm run ship -- \
  --target /storage/emulated/0/Download/tresridge-main/tresridge-main \
  --root ~/web/tresridge-main \
  [--dry-run] [--clean]
```

It stages the tree into `--root`, runs `npm ci` (or `install` when there is no
lockfile), stages a one-line `.npmrc` holding `${NPM_TOKEN}` rather than the token
itself, runs `npm publish`, and unlinks that `.npmrc` in a `finally` - publish
failing or not. The token never lands in a file, in `argv`, or in the log.
`prepublishOnly` still rules: the lane only gets you to the launchpad.

Refusals are named and exit `2`: `MISSING_TARGET`, `NOT_A_PACKAGE_TREE`,
`BAD_PACKAGE_JSON`, `BAD_PACKAGE_NAME`, `SHARED_STORAGE_ROOT`, `HOME_ROOT`,
`ROOT_SAME_AS_TARGET`, `ROOT_OCCUPIED`, `BAD_TOKEN`, `NPMRC_EXISTS`. It never
deletes on its own - `ROOT_OCCUPIED` prints the `rm -rf` line and stops. `--clean`
removes only the root it staged in that run, never the target.

Run `--dry-run` first: it exercises the whole lane including `prepublishOnly` and
publishes nothing.

The tag then cuts the GitHub release (notes from the CHANGELOG's `[0.9.0]` section,
the exact served tarball attached) and runs the verify ladder. A 0.x cut carries no
provenance attestation - only the OIDC lane stamps one - so the verify job checks the
served tarball's contents and integrity instead and says so. 1.0.0+ asserts the
attestation, because there the lane produced it.

To check the published result yourself, `npm run release:verify -- --npm` walks the
registry ladder (latest == packaged version, served sha512 == metadata integrity,
then the full pack ladder on the bytes actually served). `npm run release:verify --
--pack <tgz>` runs the same contents ladder offline on a tarball. Both carry
`--allow packs/` because `packs/` is on coreforge's family-default forbidden list
while the reference pack is a shipped artifact here.

The 0.9.0 cut was a manual publish, so it carries no provenance attestation. The
ladder asserts one, so `--npm` reports that as a named failure on 0.x by design;
`publish.yml` routes 0.x to the `--pack` ladder instead, which checks the served
bytes and integrity minus the attestation this lane cannot produce.

Publishing is **optional and synmergia-owned**. The standard is useful as a repo and a CLI
invoked from a checkout; npm is a convenience, not a dependency.

## 2. Before a cut

```
npm run check     # tool battery + site gates
git status        # clean tree
```

`prepublishOnly` runs `npm run check`, so a cut cannot happen without it.

## 3. The two halves

- **The tool** (`bin/`, `src/`, `spec/`, `packs/`) - the standard. `npm run check:tool` is
  the battery, the drift gate, and the vocabulary census.
- **The site** (`web/`, `docs/`, `site.config.js`) - the coreforge rig. `npm run site:check`
  runs the gates; `npm run site:sync` fans the identity out; `npm run site:doctor` is the
  truth battery. The site deploys to Cloudflare Pages (landing, `main` production / `staging`
  preview) and GitHub Pages (docs, via the pinned `docs-deploy.yml` lane).

## 4. What is NOT part of this repo

- **No `adapter/`.** There is no adapter directory in the family and none here.

The family roster entry lives in **govstruct** (`members/tresridge.json`), not in this repo -
a member declares its roles where the roster is read, so the roster cannot disagree with
itself across repos. `railyard` mounts the member for orchestration.

## 5. CI

`.github/workflows/test.yml` runs two jobs. The **tool battery** runs `npm run check:tool` on
Node 20 and 22. The **site battery** runs `npm run site:check`, `npm run site:sync:check`, the
web build, and the Jekyll docs build. The reference deployment wires its own lane against a
pinned commit.
