import type { Metadata } from 'next';
import { LINKS, Wordmark } from '@/ui/wordmark';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="packet-page packet-page--spent">
      <header className="wrap masthead">
        <Wordmark href="/" />
        <p className="caps caps--quiet">Solana devnet</p>
      </header>
      <main className="wrap">
        <div className="packet">
          <div className="packet__body">
            <h1 className="h2">Nothing at this address</h1>
            <p className="section__intro">Packet links look like /p/ followed by the packet&rsquo;s address. Everything else is on the front page.</p>
            <div className="packet__actions">
              <a className="btn btn--primary" href="/">
                What Bao is
              </a>
              <a className="btn btn--ghost" href={LINKS.release}>
                Get the Android app
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
