/**
 * pages/Home.jsx - the shell's placeholder landing. Replace the copy, keep
 * the structure: usePageMeta lives in the component BODY (calling it inside
 * another effect was an invalid hook call - React #321 tore the tree down on
 * the live crashtest site; transcribed fix, see labs/TASKS.md), the .code
 * pre carries the token classes the docs Rouge output shares (.k/.cm), and
 * CTAs compose .btn + a color modifier (the base class carries geometry).
 */
import usePageMeta from '../hooks/usePageMeta.js'
import site, { routeMeta } from '../site.js'

export default function Home() {
  const meta = routeMeta('/')
  usePageMeta({ siteUrl: site.url, path: '/', title: meta.title, description: meta.description })
  return (
    <section className="hero">
      <div className="wrap">
        <p className="eyebrow">{site.name}</p>
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
        </div>
        <pre className="code"><span className="cm"># no declaration needed - it derives the graph from the tree</span>{'\n'}npx <span className="k">tresridge</span> <span className="k">graph</span> data/ --out relations.json{'\n'}<span className="cm"># {'>'} 55 families, 1097 records, 57 edges inferred, 16 fields need declaring</span></pre>
      </div>
    </section>
  )
}
