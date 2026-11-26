/**
 * pages/Home.jsx - the landing page. usePageMeta stays in the component BODY
 * (calling it inside an effect was an invalid hook call - React #321, see
 * labs/TASKS.md). The .code pre carries the token classes the docs Rouge output
 * shares (.k/.cm); CTAs compose .btn + a color modifier.
 *
 * Every number below is measured, not remembered: `node bin/cli.mjs doctor`
 * over the reference consumer tree reports 55 families / 1097 records / 57
 * edges inferred / 16 fields to declare, and `rules --json` reports 15 codes.
 */
import usePageMeta from '../hooks/usePageMeta.js'
import site, { routeMeta } from '../site.js'

export default function Home() {
  const meta = routeMeta('/')
  usePageMeta({ siteUrl: site.url, path: '/', title: meta.title, description: meta.description })
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <img
            className="hero-lockup"
            src="/brand-lockup.webp"
            width="1540"
            height="866"
            alt={site.name}
          />
          <p className="eyebrow">The .tres relation standard</p>
          <h1>
            Declare the edge,{' '}
            <span className="accent">resolve or refuse.</span>
          </h1>
          <p className="lede">
            A tree of records becomes a declared graph, and one lint refuses a dangling or
            undeclared reference at author time. Point tresridge at the tree you already
            have: it reads your families and edges before you write a single declaration,
            then names the references that break. No refactor, no schema, one CI gate.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href={site.repo}>See the repo</a>
            <a className="btn btn-ghost" href={`${site.docs.url}/`}>Read the docs</a>
            <a className="btn btn-ghost" href={site.npm}>npm</a>
          </div>
          <pre className="code"><span className="cm"># no declaration needed - it derives the graph from the tree</span>{'\n'}npx <span className="k">tresridge</span> <span className="k">graph</span> data/ --out relations.json{'\n'}<span className="cm"># {'>'} 55 families, 1097 records, 57 edges inferred, 16 fields need declaring</span>{'\n\n'}<span className="cm"># then the gate CI calls: every declared edge resolves, no undeclared _id</span>{'\n'}npx <span className="k">tresridge</span> <span className="k">lint</span> data/</pre>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>The failure this kills</h2>
          <p className="sub">
            A field that points at a record which does not exist. It is not an error in most
            trees; it is a warning in a log nobody reads, found by a player instead of a build.
          </p>
          <div className="grid">
            <div className="card">
              <h3><span className="glyph">&#9679;</span>Dangling references</h3>
              <p>
                A quest names a giver that was renamed two commits ago. The loader picks
                up nothing and the break surfaces in play. tresridge refuses it in CI, with
                the file and the field.
              </p>
            </div>
            <div className="card">
              <h3><span className="glyph">&#9679;</span>Undeclared ids</h3>
              <p>
                A record carries an <code>_id</code> field no one declared, so half the tree
                resolves around it. The same lint names it before it becomes load-order
                folklore.
              </p>
            </div>
            <div className="card">
              <h3><span className="glyph">&#9679;</span>Cycles and duplicates</h3>
              <p>
                Two records with one id are one identity with two bodies. A cycle across
                declared edges never terminates the loader. Both are refusals, not warnings.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>How adoption runs</h2>
          <p className="sub">
            Start from truth, not a blank page. Inference seeds the declaration; the declared
            graph is authoritative from then on.
          </p>
          <div className="pipeline">
            <div className="pipe-step">
              <span className="pipe-n">01</span>
              <span><strong>Graph.</strong> Read the tree you already have. Families, records,
                and the edges it can infer from field names.</span>
            </div>
            <div className="pipe-step">
              <span className="pipe-n">02</span>
              <span><strong>Declare.</strong> Confirm or correct the draft. A union edge, a
                virtual edge, or a literal field is a line in <code>relations.json</code>.</span>
            </div>
            <div className="pipe-step">
              <span className="pipe-n">03</span>
              <span><strong>Lint.</strong> One gate in CI. Exit <code>0</code> clean,{' '}
                <code>1</code> violations, <code>2</code> usage - a contract a pipeline reads
                without parsing prose.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>The edge grammar, in one screen</h2>
          <p className="sub">
            One grammar, one resolution contract, many hosts. No consumer restates an edge. 
            Five kinds: <code>ref</code>, <code>refs</code>, <code>nested</code>,{' '}
            <code>virtual</code>, <code>literal</code>.
          </p>
          <pre className="code">{`{
  "schemaVersion": 1,
  "families": [ { "key": "npcs", "schema": "NpcData" }, ... ],
  "edges": [
    { "family": "npcs", "field": "home_zone_id", "target": "zones", "kind": "ref" },
    { "family": "loot_tables", "field": "entries.item_id", "target": "zones", "kind": "nested" },
    { "family": "npcs", "field": "book_id", "kind": "virtual",
      "pattern": "book_<npc>_<tier>" }
  ]
}`}</pre>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>What it ships with</h2>
          <p className="sub">Zero runtime dependencies. Measured, not promised.</p>
          <div className="grid">
            <div className="card">
              <h3><span className="glyph">&#9679;</span>15 refusal codes</h3>
              <p>
                One published vocabulary, <code>spec/refusals.json</code>, read by{' '}
                <code>rules --json</code>. A code that drifts from the spec fails the suite.
              </p>
            </div>
            <div className="card">
              <h3><span className="glyph">&#9679;</span>Five verbs</h3>
              <p>
                <code>lint</code> judges, <code>graph</code> derives, <code>doctor</code>{' '}
                summarises, <code>rules</code> prints the vocabulary, and{' '}
                <code>lint-packs</code> holds a packstruct pack to the same spec.
              </p>
            </div>
            <div className="card">
              <h3><span className="glyph">&#9679;</span>The spec, not a blog post</h3>
              <p>
                The normative grammar and resolution rule live in <code>spec/SPEC.md</code>{' '}
                in the repo. The CLI implements what the spec says, and the conformance
                harness holds both.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Adopted against a real tree</h2>
          <p className="sub">
            The reference consumer is a live game tree, not a fixture. These are its numbers
            from <code>doctor</code>, re-runnable in one command.
          </p>
          <div className="table-wrap">
            <table className="attacks">
              <thead>
                <tr><th>Metric</th><th>Result</th></tr>
              </thead>
              <tbody>
                <tr><td className="mod">families</td><td><span className="what">55</span></td></tr>
                <tr><td className="mod">records</td><td><span className="what">1,097</span></td></tr>
                <tr><td className="mod">edges inferred</td><td><span className="what">57</span></td></tr>
                <tr><td className="mod">fields to declare</td><td><span className="what">16</span></td></tr>
                <tr><td className="mod">violations</td><td><span className="shipped">0</span></td></tr>
              </tbody>
            </table>
          </div>
          <p className="field-report">
            A root far above the tree root is refused too, naming the path to try:{' '}
            <span className="ok">not-a-tree-root</span> rather than a silent empty pass.
          </p>
        </div>
      </section>
    </>
  )
}
