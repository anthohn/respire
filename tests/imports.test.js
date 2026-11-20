import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Garde-fou : tout ce qu'un module importe d'un autre module doit exister. Une fonction supprimée par erreur ferait
// planter l'application entière au chargement, sans qu'aucun test unitaire (qui n'importent pas les vues) ne s'en aperçoive.
const dir = new URL('../js/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

test('chaque import nommé d’un module existe dans le module visé', async () => {
  const problems = [];
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.js)'/g)) {
      const mod = await import(new URL(m[2], dir));
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name && !(name in mod)) problems.push(`${file} importe « ${name} » depuis ${m[2]}, qui ne l’exporte pas`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
