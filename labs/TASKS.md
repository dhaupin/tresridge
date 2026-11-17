# labs/TASKS.md - tresridge work log

> Rolling log. Companion to [`labs/prd-tresridge.md`](./prd-tresridge.md) (the product contract). Newest session at top. Struck items are done.

Last updated: 2026-11-17.

## Session 2026-11-17 - the first cut (M0 opens)

- The repo opens with the normative spec ([`spec/SPEC.md`](../spec/SPEC.md)), the front door ([`README.md`](../README.md)), and the product contract ([`labs/prd-tresridge.md`](./prd-tresridge.md)).
- Core law fixed: **declare the edge, resolve or refuse.** The edge declaration is the shared-facts column; the record body stays host-owned.
- Frozen v1 grammar: the family table (`key`/`schema`/`idPrefix`/`filename`), the edge table (`field`/`target`/`kind`/`required`), and five edge kinds (`ref`, `refs`, `nested`, `virtual`, `literal`). The fifth - `literal` - is the honesty kind that keeps the undeclared-`_id` refusal from losing its teeth.
- The resolution rule (last family token, pluralised) is fixed as **inference, not contract**: it seeds a declaration and MUST NOT run at check time.
- Evidence base is the reference deployment's probe: 1097 records, 55 families, 344 edges, 14 undeclared fields, 6 dangling. The probe (`scripts/tresridge_probe.mjs`, 122 lines, zero deps) proves the extraction.
- Name checked for collisions: `tresridge` free; `ridge` is a generic terrain noun in the reference corpus, not a named concept (unlike Forge).

### Open

- [ ] M0: freeze `spec/SPEC.md` against a second host's reality (one host is a picture, two is a pattern)
- [ ] M1: `bin/cli.mjs` + `src/{lint,graph,doctor}.mjs` - the probe becomes a CLI with `relations.json` and the exit contract
- [ ] M1: `relations.json` schema + the `--against` drift gate
- [ ] M2: fixture trees (one clean, one per refusal norm) + `npm test`
- [ ] M2: npm publish (name verified free: `npm view tresridge` = E404)
- [ ] M3: the reference deployment authors `game/core/data/relations.gd` and rewrites its 2272-line regex lint as assertions over the walker
- [ ] docs: the `/docs` site (Jekyll + Pagefind + Freestruct, poststruct-audited) and `tresridge.creadev.org`
