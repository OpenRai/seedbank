export function SiteFooter() {
  return <footer className="site-footer"><div className="container site-footer__grid">
    <div><strong><span className="about-label">About </span><span className="about-seed">seed</span><span className="brand__accent">bank</span></strong>
      <p style={{ margin: '6px 0 0' }}>A deterministic browser over the <a href="https://nano.org/">Nano cryptocurrency</a> keyspace. Every private key and seed phrase is derived at view-time from its position in the 2<sup>256</sup> range — nothing is stored, indexed, or pregenerated.</p>
    </div><div>© 2026 The OpenRai Initiative</div>
  </div></footer>;
}
