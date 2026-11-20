# PRD: tresridge marketing — order from scatter

**Status:** v0.1 — starter brew (2026-11-17) · Owner: dhaupin
**Role:** the go-to-market arm of the relation standard. It owns *who this is for, what we say, and how we know it landed*. It owns **not** the grammar (that is [`spec/SPEC.md`](../spec/SPEC.md)) and **not** the numbers (those live in [`labs/prd-tresridge.md`](./prd-tresridge.md), and are cited, never re-derived).
**Audience:** the developer who has a directory of `.tres` files that reference each other by convention, and no idea which references are broken.
**Core message:** *Declare the edge, resolve or refuse — and get your sanity back.*
**Anti-message:** "adopt our standard." Nobody wakes up wanting a standard. They wake up wanting to know why `loot_bandit.tres` loads a currency that does not exist.

---

## 1. The one-line pitch

**Point tresridge at the tree you already have. It tells you what you have, what dangles, and what is undeclared — before you write a single declaration.**

## 2. Who this is for (the scattered tree)

There is a condition, and it has a shape. Call it **the scattered tree**: a content directory that grew one record at a time, each added by whoever needed it that week.

| The condition | What it looks like |
|---|---|
| **Conventions, not declarations** | `currency_id` is `"currency_gold"` in the schemas and `"gold"` in every loot table. Both load. Neither is the law. |
| **Accreted naming** | `item_` here, `itm_` there. Three prefixes for one concept, all in use. |
| **References as strings** | A quest names an NPC by string. Nothing checks it. The loader logs a warning nobody reads. |
| **The lint you fear** | A hand-written parser (the reference deployment's is **2272 lines** of bespoke regex, one scanner per relation) that nobody dares extend. |
| **The invisible drop** | A sync allowlist that silently stops copying directories. The reference deployment's dropped **19 populated directories / 119 files** before anyone noticed. |
| **Onboarding by memory** | The conventions live in one person's head. A new dev learns them by breaking them. |

The reference deployment is this condition, measured: **1097 `.tres` records across 55 families**, rebuilt in three languages, with the mapping forked. It is not a pathological case. It is the *normal* case for any content-heavy Godot project past a few hundred records.

**Who this is NOT for:** a tree of three files. A project with no cross-references. Anyone who wants a schema system or a runtime loader — see §8.

## 3. The pain, named

Marketing that does not name the pain is decoration. These are the sentences the audience already says:

1. *"I renamed a record and I have no idea what broke."* → renaming is a leap of faith.
2. *"Which convention is authoritative?"* → two registries contradict; neither is the source.
3. *"What references what?"* → the graph exists, in nobody's head, drawn by nobody.
4. *"I can't touch the content lint."* → the gate is more fragile than the content.
5. *"Godot loaded it fine."* → the failure mode is silence. A dangling id is not an error, it is a warning in a log.

The last one is the root. **The system's default is silence.** Every other pain is a symptom of a toolchain that guesses instead of declaring.

## 4. What "sanity" looks like

Sanity is not a feature. It is a state of the tree. The promise is a before/after, and it is checkable:

| | Scattered | Ordered |
|---|---|---|
| **The shape** | conventions in prose | a declaration file: families, edges |
| **The check** | a 2272-line regex parser | one lint, one line per refusal |
| **A rename** | a leap of faith | `lint` refuses the moment a target dangles |
| **The graph** | in nobody's head | `graph` prints it, `doctor` summarises it |
| **Onboarding** | by memory | read `relations.json`; it is the whole law |
| **A new dev's first bug** | finds it in playtest | finds it at author time, with a filename |

The last row is the whole point: **the refusal moves from playtest to author time.** That is the sanity. Not a dashboard — a one-line error before the content ships.

## 5. The wedge: `graph` on a tree you never described

The adoption problem for any standard is "describe everything first." tresridge inverts it. The first command needs **no declaration at all**:

```
npx tresridge graph data/ --out relations.json
```

It reads the tree and *derives* the declaration from truth — families, schema identities, id prefixes, and edges, using the resolution rule ([`spec/SPEC.md`](../spec/SPEC.md) §6). You start from what you have, not a blank page. The residue — the fields the rule could not resolve — is printed as a short, honest list: *these need your call.*

This is the wedge because it is **zero-commitment and immediately useful**. The user gets their graph before they get a standard.

## 6. The first ten minutes

The most important marketing asset is not a page. It is what happens in the first ten minutes. Here is the honest script, run against the reference deployment's tree — every line below is a real command and its real output:

```bash
# 1. It reads a tree you never described. No declaration needed.
npx tresridge graph data/ --out relations.json
#    -> 55 families, 1097 records, 57 edges inferred, 16 fields need declaring

# 2. It tells you what is broken. One declaration file, no refactor.
npx tresridge lint data/ --decl relations.json
#    -> 6 violation(s), 0 warning(s)   (exit 1)

# 3. The full pass: families, edges, residue, and the violations.
npx tresridge doctor data/ --decl relations.json
#    -> 55 families, 1097 records
#    -> edges inferred 57 | needs declaring 16 | declared edges 73 | violations 6
```

**The aha is step 1.** On a tree the user has never described, tresridge derives the graph — 57 edges — and names the 16 fields that need a human call. The user gets their shape before they get a standard.

**The proof is step 2.** Six dangling references, in a 1097-record corpus, found by a tool that has never seen the project. That number is the marketing: *you have hidden breakage, and we found it in one command.*

**The relief is the whole flow.** You do not refactor. You declare. The conventions stay; they just become checkable. And the refusal is one line naming the record and the field — never a stack trace.

**The keep is the CI gate.** Once `lint` is in the pipeline, the refusal moves to author time and stays there.

*(Publication status, stated honestly: `tresridge` is **not yet on npm** — the 0.1.x publish is the outstanding M2 item. Until it lands, the same commands run from a clone: `node bin/cli.mjs graph data/`. The script above is the target state; the page must not ship `npx` until `npm view tresridge` resolves.)*

*(Note the honesty of step 1: `graph` and `doctor` do not need a declaration to describe your tree; only `lint` needs one to judge it. That ordering is the whole adoption story — describe, then declare, then enforce.)*

## 7. Claims with receipts (the anti-fiction rule for marketing)

The house rule — no fiction, every number observed — applies to marketing hardest, because marketing is where fiction is normal. Every claim we make must cite a measurement. If a claim has no receipt, it is cut.

| Claim | Receipt |
|---|---|
| "It finds dangling references you did not know you had." | Reference deployment: **6 dangling** among the resolving references in a 1097-record corpus — and the pre-existing integrity gate *accepted* them (see [`labs/prd-tresridge.md`](./prd-tresridge.md) §2 for the probe’s convention-only count). |
| "You do not rewrite anything." | Adoption is a declaration; the tree is unchanged. The reference deployment's 55 families stay exactly where they are. |
| "It reads your tree before you declare anything." | `graph` derives families and edges from the corpus alone ([`spec/SPEC.md`](../spec/SPEC.md) §6). |
| "The check is one line per problem, not a stack trace." | The refusal contract: name the record, the field, the broken norm ([`spec/SPEC.md`](../spec/SPEC.md) §7). |
| "The refusal list is finite and named." | The shared vocabulary is 11 codes, in [`spec/refusals.json`](../spec/refusals.json). |
| "It does not guess at check time." | The lint never infers; inference only seeds a declaration ([`spec/SPEC.md`](../spec/SPEC.md) §6). |
| "It refuses to silence a problem quietly." | Baselines carry a reason and an expiry; there is no `--ignore` ([`spec/SPEC.md`](../spec/SPEC.md) §9). |

**The meta-claim, and the best one:** tresridge's own tooling is held to the same standard it sells. The vocabulary, the registry, and the conformance battery are one source, and a gate refuses when they drift (`scripts/check-vocabulary.mjs`). *We ship the discipline we are asking you to adopt.* That is the credibility, and it is not a slogan — it is a CI step.

## 8. What we do not claim

Honest scoping is a marketing asset. Every "no" here is a trust deposit.

- **Not a schema system.** tresridge declares edges, not fields. Your record shape stays yours.
- **Not a runtime loader.** It governs the declaration and the refusals; your loader is your own.
- **Not a platform, not a registry, not a service.** A spec and a lint. Distribution is git plus npm. No account, no signup, no telemetry.
- **Not Godot-only, but Godot-first.** The grammar is host-neutral; the wedge is `.tres`, because that is where the scattered trees are. We lead with Godot and say so.
- **Not a refactor.** It never asks you to rename anything. (The reference deployment's two contradictory conventions are *acknowledged as baselines*, not silently "fixed" — the reference deployment's `labs/prd-tres.md`.)
- **Not a family membership.** tresridge keeps the struct family's *model* but is a **synmergia project** — no roster entry, no family-domain site. We do not sell the fleet; we sell the ridge.

## 9. Where they find us

| Surface | Purpose |
|---|---|
| `npm install tresridge` / `npx tresridge` | the zero-install try: one command, one verdict |
| `tresridge.creadev.org` | the landing page: the one-line pitch, the ten-minute script, the receipts |
| `docs.creadev.org/tresridge` | the docs: the spec, the vocabulary, the extension surface, worked profiles |
| the GitHub repo | the conformance cases — the proof a stranger can verify before adopting |
| `README.md` | the front door for the repo-native audience |

The landing page has one job: get the visitor to run `npx tresridge doctor` on their own tree. Every other asset feeds that.

## 10. The message ladder

Reuse the four-step adoption ladder ([`labs/prd-tresridge.md`](./prd-tresridge.md) §13) — canonicalize, do not re-inline a second ladder.

| Step | Audience question | Our answer |
|---|---|---|
| **Awareness** | "Do I have this problem?" | the scattered-tree symptoms (§3), named |
| **Try** | "Does it work on *my* tree?" | `graph` + `doctor`, zero declaration, the dangling count |
| **Adopt** | "What do I have to change?" | declare, do not refactor; one CI gate |
| **Advocate** | "Why should I tell someone?" | the same discipline runs on our own repo; the graph is shareable |

Each step has one asset and one proof. Awareness sells the condition, not the tool. Try sells the verdict. Adopt sells the relief. Advocate sells the receipts.

## 11. Voice and naming

- **Lead with the user's tree, never the grammar.** The first sentence is about their records, not our spec.
- **Name the failure mode plainly: silence.** "Godot loaded it fine" is the villain of every page.
- **Numbers, always.** "6 dangling in 1097 records" beats "powerful validation."
- **The ridge, not the fleet.** The name is ours — a ridge is the raised spine connecting peaks, which is what a graph is. We are a path between places, not a platform.
- **No superlatives without a receipt.** "Zero-dependency" is fine (it is `package.json`). "Blazing" is not.

## 12. Success signals (sanity, not stars)

We are not optimising for stars. We are optimising for a state: **a developer who can see their graph and trusts their gate.** The signals, in order of meaning:

| Signal | Why it matters |
|---|---|
| **Time to first verdict** | how fast `npx tresridge doctor` prints a count on a real tree. The lower, the better the wedge. |
| **Dangling found per adoption** | the number of hidden breaks a new user discovers. This is the value delivered, and it is countable. |
| **Declarations committed** | a `relations.json` in a repo we did not write. That is a real host. |
| **CI gates added** | the refusal moved to author time somewhere. The sanity took hold. |
| **Profiles published** | a host extended the lint with its own rules — the extension surface worked. |

Stars and downloads are lagging vanity. The leading signal is the dangling count on first run: if it is zero for most trees, the wedge is wrong and we should say so.

## 13. Open questions

- **Does the wedge hold on a tree of 50 records, not 1097?** The reference deployment is large. If small trees have no dangling references, the pitch needs a different first hook. **Unmeasured — the next experiment.**
- **Do we ship a "scattered tree" example repo?** A deliberately messy corpus a visitor can run against in one command would prove the wedge without asking them to try their own first.
- **Is `doctor` or `graph` the better first command?** `graph` writes a file; `doctor` only reads. The zero-side-effect one may convert better.
- **What is the honest promise on false positives?** We claim zero on the reference tree. A stranger's tree may differ; the page must not overpromise.

## 14. Change log

| Date | Author | Summary |
|---|---|---|
| 2026-11-17 | dhaupin + OpenHands agent | Initial creation (v0.1, starter brew). Audience-first: the scattered tree, the silence failure mode, the `graph`/`doctor` wedge, the ten-minute script, claims-with-receipts, honest non-claims, and sanity-not-stars success signals. Reuses the four-step adoption ladder rather than inlining a second one. |
