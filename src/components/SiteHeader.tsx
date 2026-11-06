import { SeedKeyIcon } from '@components/Icons';

export function SiteHeader({ active }: { active: 'keys' | 'mnemonics' }) {
  return <header className="site-header"><div className="container site-header__inner">
    <a className="brand" href="/"><span className="brand__mark" aria-hidden="true"><SeedKeyIcon width={17} height={17}/></span><span>seed<span className="brand__accent">bank</span><span className="brand__domain">.openrai.org</span></span></a>
    <nav className="site-nav" aria-label="Keyspace view"><a className={`site-nav__link${active === 'keys' ? ' site-nav__link--active' : ''}`} aria-current={active === 'keys' ? 'page' : undefined} href="/?view=keys">Private keys</a><a className={`site-nav__link${active === 'mnemonics' ? ' site-nav__link--active' : ''}`} aria-current={active === 'mnemonics' ? 'page' : undefined} href="/?view=mnemonics">Mnemonic seeds</a></nav>
  </div></header>;
}
