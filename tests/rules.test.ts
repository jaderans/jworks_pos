import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULES_VERSION } from '../src/sync/rulesVersion';

describe('Firestore rules', () => {
  const rules = readFileSync('firebase/firestore.rules', 'utf8');
  const ruleFor = (table: string) => rules.split(/\r?\n/).find((l) => l.includes(`match /${table}/{id}`)) ?? '';

  it('carry the version this app checks for', () => {
    expect(rules).toContain(`RULES VERSION ${RULES_VERSION}`);
    expect(rules).toContain(`allow read: if signedIn() && v == '${RULES_VERSION}'`);
  });

  it('let the whole team edit the catalog and prices, but not costs', () => {
    for (const t of ['t_categories', 't_products', 't_bundleRules', 't_eventProducts']) expect(ruleFor(t), t).toContain('allow write: if isTeam(ws)');
    for (const t of ['t_productCosts', 't_costPoints', 't_materials', 't_spend']) expect(ruleFor(t), t).toContain('allow read, write: if isOwner(ws);');
  });

  it('let the whole team work print orders and read the print rate card', () => {
    expect(ruleFor('t_printOrders')).toContain('allow read: if isTeam(ws); allow write: if isTeam(ws)');
    expect(rules).toContain("(isTeam(ws) && key == 'printRates')");
  });
});
