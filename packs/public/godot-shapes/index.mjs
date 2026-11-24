// godot-shapes - the Godot reference deployment's own law, as a pack.
//
// The rule is host-specific on purpose: it is NOT in the shared spec. That is
// what a pack is for - the grammar stays frozen, the host layers its own law. A
// pack rule obeys the same two laws as any host rule (SPEC section 12): it may
// not invent a code, and it may not weaken a standing refusal.
//
// Two consumers read this module, so it exports one shape twice:
//   - tresridge's loader reads `checks` (or `rules`), each a RULE: the same
//     object the in-repo registry holds, so a pack rule and a core rule run
//     through one pipeline and one vocabulary.
//   - packstruct's `check` profile reads the DEFAULT EXPORT (SPEC section 3), so
//     `packstruct lint --deep` can import and census this pack without a
//     tresridge-shaped adapter in between.
// The two are the same array under two names, never a copy that can drift.

/** @type {import('../../../src/rules.mjs').Rule[]} */
export const checks = [
  {
    // `code` is tresridge's name for it; `id` is the key packstruct's census
    // reads (SPEC section 7, --deep). Carrying both keeps one check visible to
    // both consumers instead of exporting a second copy that can drift.
    id: 'godot/id-required-when-prefixed',
    code: 'godot/id-required-when-prefixed',
    severity: 'violation',
    scope: 'tree',
    run(ctx) {
      const out = [];
      for (const r of ctx.tree.records) {
        const fam = ctx.declFamily.get(r.family);
        if (!fam || !fam.idPrefix) continue;
        if (!r.idDeclared) {
          out.push({
            code: 'godot/id-required-when-prefixed',
            record: r.file,
            detail: `family ${fam.key} declares idPrefix "${fam.idPrefix}" but the record carries no explicit id line`,
          });
        }
      }
      return out;
    },
  },
];

export const rules = checks;

export default { checks, rules };
