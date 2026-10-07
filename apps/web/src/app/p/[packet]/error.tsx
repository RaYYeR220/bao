'use client';

import { LINKS, Wordmark } from '@/ui/wordmark';

/** The packet could not be loaded (the database or the RPC did not answer). The link itself may be fine. */
export default function PacketError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="packet-page packet-page--spent">
      <header className="wrap masthead">
        <Wordmark href="/" />
        <p className="caps caps--quiet">Solana devnet</p>
      </header>
      <main className="wrap">
        <div className="packet">
          <div className="packet__body">
            <h1 className="h2">This packet did not load</h1>
            <p className="section__intro">The server could not read it just now. The packet itself is on Solana and is not affected.</p>
            <div className="packet__actions">
              <button className="btn btn--primary" type="button" onClick={reset}>
                Try again
              </button>
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
