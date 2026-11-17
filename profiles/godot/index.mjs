// The godot reference profile - the worked example of the extension surface.
//
// Its rule is host-specific on purpose: it is NOT in the shared spec. That is the
// point of a profile - the grammar stays frozen, the host layers its own law.
// A profile rule obeys the same two laws as any host rule (SPEC section 12):
// it may not invent a code, and it may not weaken a standing refusal.

/** @type {import('../../src/rules.mjs').Rule[]} */
export const rules = [
  {
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
