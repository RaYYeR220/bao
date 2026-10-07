import { Envelope } from '@/ui/envelope';
import { LINKS, Wordmark } from '@/ui/wordmark';

/** No packet at this address: mistyped, cut short, or never dropped on devnet. */
export default function PacketNotFound() {
  return (
    <div className="packet-page packet-page--spent">
      <header className="wrap masthead">
        <Wordmark href="/" />
        <p className="caps caps--quiet">Solana devnet</p>
      </header>
      <main className="wrap">
        <div className="packet">
          <div className="packet__envelope">
            <Envelope id="missing" tone="ash" shares={3} left={0} amount="?" caption="no packet here" />
          </div>
          <div className="packet__body">
            <h1 className="h2">There is no packet at this link</h1>
            <p className="section__intro">
              The address may be cut short or mistyped, or nothing was ever dropped there on devnet. Ask the sender for the link
              again.
            </p>
            <div className="packet__actions">
              <a className="btn btn--primary" href={LINKS.release}>
                Get the Android app
              </a>
              <a className="btn btn--ghost" href="/">
                What Bao is
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
