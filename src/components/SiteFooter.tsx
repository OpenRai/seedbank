export function SiteFooter() {
  return <footer className="site-footer"><div className="container site-footer__grid">
    <div><strong><span className="about-label">About </span><span className="about-seed">seed</span><span className="brand__accent">bank</span></strong>
      <p style={{ margin: '6px 0 0' }}>A deterministic browser over the <a href="https://nano.org/">Nano cryptocurrency</a> keyspace. Every private key and seed phrase is derived at view-time from its position in the 2<sup>256</sup> range — nothing is stored, indexed, or pregenerated.</p>
    </div><div>
      <p style={{ margin: 0 }}><a href="/?view=ill-nan">ill-nan view</a> enumerates the roughly 2<sup>47</sup> candidate phrases that CryptoJS&apos;s weak randomness exposed, demonstrating how the <a href="https://illbloom.org/articles/cryptojs-vulnerability/">Ill Bloom bug</a> could have affected Nano.</p>
      <p>© 2026 The OpenRai Initiative</p>
    </div>
  </div></footer>;
}
