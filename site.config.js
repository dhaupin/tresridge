/**
 * site.config.js - THE site identity, authored once, read everywhere.
 *
 * This is the one file an adopter edits for identity. Everything else derives
 * from it: the JS surfaces import it directly (no generation, no drift), and
 * `npm run sync` fans the non-JS surfaces out of it (web/ssr.config.js,
 * docs/freestruct.config.yml, docs/_config.yml, web/public/robots.txt,
 * web/public/site.webmanifest). The brand census gate refuses an identity
 * literal that lives anywhere else, so "replace every YOUR... value" is
 * mechanical, not a manual hunt across three languages.
 *
 * Named site.config.js, not tresridge.config.js, on purpose: the config is
 * named for the CONCERN (the site), never the tool. prestruct reads
 * web/ssr.config.js and freestruct discovers docs/freestruct.config.yml - both
 * engine-owned, both DERIVED here. A product-named config would force those
 * engines to depend on this repo; this shape keeps the dependency pointing
 * from shell to engines, never the reverse (the derivation model, PRD 5.1).
 *
 * The docs identity (docs/_config.yml, freestruct.config.yml) and the landing
 * identity (ssr.config.js, robots, webmanifest) come from ONE block below, so
 * the landing and the docs cannot disagree about who they are.
 */
export default {
  // --- identity -----------------------------------------------------------
  name: 'tresridge',
  wordmark: { accent: 'tres', rest: 'ridge' },
  badge: 'v0.1',
  tagline: 'Declare the edge, resolve or refuse.',
  description:
    'The .tres relation standard: point tresridge at the tree you already have, and it tells you what you have, what dangles, and what is undeclared.',
  url: 'https://tresridge.creadev.org',
  repo: 'https://github.com/dhaupin/tresridge',
  author: 'dhaupin',
  license: 'MIT',
  keywords:
    'tresridge, tres, godot, relations, graph, spec, lint, dangling-reference, docs, landing-page, prerender, react, vite',

  // The maker line + org (footer + the docs layout's provenance row).
  maker: { label: 'Rook @ Creadev.org', url: 'https://creadev.org' },
  org: { name: 'Creadev.org', url: 'https://creadev.org' },

  // --- docs ---------------------------------------------------------------
  // docsUrl is the full public docs URL; docsHost is the Jekyll `url` (the
  // freestruct layer reads host + path separately).
  docs: {
    title: 'tresridge docs',
    url: 'https://docs.creadev.org/tresridge',
    host: 'https://docs.creadev.org',
    baseurl: '/tresridge',
  },

  // --- theme --------------------------------------------------------------
  // The two axes as data. themeKey/schemeKey are protocol constants shared by
  // the pre-paint bootstrap, both switches, and the docs layout - they are NOT
  // brand, so they stay stable across rebrands.
  theme: {
    themeKey: 'site-theme',
    schemeKey: 'site-paint-scheme',
    defaultMode: 'light',
    defaultScheme: 'petrol',
  },

  // --- nav vocabulary -----------------------------------------------------
  // ONE list the header, the burger sidebar, and the footer all render from.
  // 'site' = internal route (NavLink-active); 'out' = external surface (the
  // header GitHub icon replaces this entry's label there; the footer still
  // renders the text link).
  nav: [
    { label: 'Home', to: '/', end: true, group: 'site' },
    { label: 'GitHub', href: 'https://github.com/dhaupin/tresridge', group: 'out' },
  ],
  // Footer-only extras (legal + provenance). Keep legal labels smaller than
  // the nav; provenance links belong in the footer, not the header.
  footerExtras: [
    { label: 'Terms', href: '/terms' },
    { label: 'Privacy', href: '/privacy' },
  ],

  // --- routes -------------------------------------------------------------
  // One entry per Route in web/src/AppLayout.jsx; drives the sitemap, the
  // prerender list, and the per-page meta. `title`/`description` are the
  // canonical per-route meta; the page component may override via usePageMeta.
  routes: [
    {
      path: '/',
      priority: '1.0',
      changefreq: 'monthly',
      meta: {
        title: 'tresridge - the .tres relation standard',
        description:
          'Point tresridge at the tree you already have: it tells you what you have, what dangles, and what is undeclared, before you write a single declaration.',
      },
    },
    {
      path: '/terms',
      priority: '0.3',
      changefreq: 'yearly',
      meta: {
        title: 'Terms | tresridge',
        description: 'The terms of use for tresridge, the .tres relation standard: what it promises, what it does not, and how it is licensed.',
      },
    },
    {
      path: '/privacy',
      priority: '0.3',
      changefreq: 'yearly',
      meta: {
        title: 'Privacy | tresridge',
        description: 'What this site collects: nothing hidden, no tracking, no telemetry. tresridge is a lint you run, not a service you sign up for.',
      },
    },
  ],

  // The static 404 the host serves every miss; the shape + copy match
  // pages/NotFound.jsx so the host-not-found and the hydrate-not-found read
  // as one page, not two.
  notFound: {
    heading: '404',
    body: 'That page does not exist here.',
    primaryCta: { label: 'Back home', href: '/' },
  },
}
