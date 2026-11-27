// test/npm-parity.mjs - the npm parity gate (a new law ships with a fixture
// that breaks it).
//
// Every published family site advertises its package on npm, on every surface
// it ships: the web nav and the docs header. The link must resolve to the name
// in package.json - a URL that names some other package survives a rename and
// is a dead surface nobody notices until a user clicks it.
//
// tresridge is a PUBLISHED-coreforge consumer: its docs/_config.yml is
// sync-owned by coreforge 1.0.0, which does not fan `npm_url`, so the docs
// header builds the URL from the generated docs title instead of a brand
// literal (the brand census refuses one). This gate holds that chain: the
// templated tail is only correct while the docs title equals the package name.
//
// The bite: a mutation fixture drops each surface in a temp copy and proves the
// gate refuses it. A check that cannot fail is not a check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));

// The surfaces that must carry the link, and the pattern that proves it. The
// docs surface derives the URL from `{{ site.title }}` (the docs title, itself
// generated from site.config.js) rather than a brand literal: the brand census
// refuses a hardcoded name in a structural surface, and a literal a rebrand
// would have to rename by hand is exactly the drift this gate exists to catch.
const SURFACES = [
  { rel: 'site.config.js', name: 'the web nav', pattern: /npm:\s*'https:\/\/www\.npmjs\.com\/package\/[^']+'/ },
  { rel: 'docs/_layouts/default.html', name: 'the docs header', pattern: /href="https:\/\/www\.npmjs\.com\/package\/\{\{ site\.title \}\}"/ },
];

test('the docs title the npm URL is derived from is the published package name', () => {
  // The docs header builds the URL from site.title, so the parity of the whole
  // chain rests on this one equality. If they diverge, the link goes somewhere
  // real but wrong - worse than a dead link, because it looks wired.
  const docsTitle = read('docs/_config.yml').match(/^title:\s*(.+)$/m);
  assert.ok(docsTitle, 'docs/_config.yml must carry a title (run `npm run site:sync`)');
  assert.equal(docsTitle[1].trim(), pkg.name,
    'the docs title (site.title) must equal the package name, or the npm link points at the wrong package');
});

test('the package is published under the name the site advertises', () => {
  assert.ok(!pkg.private, 'a private package must not advertise an npm link');
  assert.match(pkg.name, /^[a-z0-9-]+$/, 'the package name must be a plain npm name');
});

for (const surface of SURFACES) {
  test(`${surface.name} advertises the package on npm`, () => {
    const text = read(surface.rel);
    assert.match(text, surface.pattern, `${surface.rel} must carry an npm link - the package is published, so the surface that ships must point at it`);
  });

  test(`${surface.name} points at THIS package, not a stale name`, () => {
    // A URL naming some other package is worse than a missing one: it looks
    // wired and sends the reader to the wrong place. The docs surface may use
    // the exact `{{ site.title }}` tail instead of a literal - its correctness
    // is the docs-title equality asserted above - but no other tail is allowed.
    const tails = [...read(surface.rel).matchAll(/npmjs\.com\/package\/(\{\{\s*site\.title\s*\}\}|[A-Za-z0-9@/_.-]+)/g)].map((m) => m[1]);
    assert.ok(tails.length > 0, `${surface.rel} must carry an npmjs URL`);
    for (const tail of tails) {
      assert.ok(tail === pkg.name || /^\{\{\s*site\.title\s*\}\}$/.test(tail),
        `${surface.rel} links the package "${tail}", which is neither "${pkg.name}" nor the templated site.title`);
    }
  });
}

test('the gate bites: dropping any one surface is refused', () => {
  // Simulate the regression the gate exists for - a surface that loses its
  // link - and prove the assertion fails. Pure in-memory: strip the URL, then
  // re-run the same check the tests above run.
  for (const surface of SURFACES) {
    const text = read(surface.rel);
    const stripped = text.replace(/https:\/\/www\.npmjs\.com\/package\/[^\s"']+/g, 'https://example.com/removed');
    assert.notEqual(stripped, text, `the fixture must actually remove a link from ${surface.rel}`);
    assert.doesNotMatch(stripped, surface.pattern, `${surface.rel} with the link removed must fail its own gate`);
  }
});
