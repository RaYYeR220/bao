import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { GrabView, PacketDetail } from '@bao/sdk';
import { countdownText } from '@/lib/countdown';
import { baseUrl, env } from '@/lib/env';
import { emptiedIn, loadPacketPage, packetCopy, shortAddress, type PacketCopy } from '@/lib/link-page';
import { formatUi } from '@/lib/tokens';
import { Envelope } from '@/ui/envelope';
import { isSkin } from '@/ui/tokens';
import { LINKS, Wordmark, explorerAddress } from '@/ui/wordmark';
import { Countdown } from './countdown';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ packet: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { packet } = await params;
  const p = await loadPacketPage(packet);
  if (!p) return { title: 'Red packet not found', robots: { index: false } };
  const copy = packetCopy(p);
  const url = `${baseUrl()}/p/${packet}`;
  const summary = `${copy.amount} · ${copy.status}`;
  const open = copy.state === 'live' || copy.state === 'scheduled';
  return {
    title: copy.title,
    description: `${summary}. ${p.message ?? (open ? 'Shake to grab in Bao.' : 'Red packets for Seeker: one Seeker, one grab.')}`,
    alternates: { canonical: url },
    openGraph: { title: copy.title, description: summary, url, siteName: 'Bao', type: 'website' },
    twitter: { card: 'summary_large_image', title: copy.title, description: summary },
    other: {
      'al:android:url': `bao://packet/${packet}`,
      'al:android:package': env().ANDROID_PACKAGE,
      'al:android:app_name': 'Bao',
    },
  };
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.9 8.2l2.1 2.1 4.1-4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** What is happening to the packet right now, and for how long. */
function State({ p, copy }: { p: PacketDetail; copy: PacketCopy }) {
  const now = Math.floor(Date.now() / 1000);
  if (copy.state === 'live') {
    return (
      <div className="packet__state">
        <p className="status status--live">{copy.status}</p>
        <Countdown target={p.expiresAt} initial={countdownText(p.expiresAt - now)} label="until it closes" done="closing" />
      </div>
    );
  }
  if (copy.state === 'scheduled') {
    return (
      <div className="packet__state">
        <p className="status status--scheduled">{copy.status}</p>
        <Countdown target={p.startsAt} initial={countdownText(p.startsAt - now)} label="until it opens" done="opening" />
      </div>
    );
  }
  const took = copy.state === 'emptied' ? emptiedIn(p) : null;
  return (
    <div className="packet__state">
      <p className="status status--ended">{copy.status}</p>
      <p className="status__note">
        {copy.state === 'emptied'
          ? took
            ? `Gone in ${took}. Nothing is left to grab.`
            : 'Nothing is left to grab.'
          : copy.left > 0
            ? `What nobody grabbed ${p.status === 'closed' ? 'went' : 'goes'} back to the sender.`
            : 'It is closed.'}
      </p>
    </div>
  );
}

/** A share as the app prints it: two decimals, four when it is under one token (so a small share is not "0"). */
function shareUi(base: string, decimals: number): string {
  return formatUi(base, decimals, BigInt(base) < 10n ** BigInt(decimals) ? 4 : 2);
}

const GRAB_LABEL: Record<GrabView['status'], string> = {
  pending: 'Waiting for randomness',
  won: 'Won, on its way',
  paid: 'Paid',
  forfeited: 'Never collected',
};
const LEDGER_ROWS = 10;

function Ledger({ p }: { p: PacketDetail }) {
  const { decimals } = p.token;
  const rows = [...p.grabs].sort((a, b) => a.index - b.index);
  const shown = rows.slice(0, LEDGER_ROWS);
  return (
    <section className="ledger" aria-labelledby="grabs">
      <div className="ledger__inner">
        <div className="ledger__head caps">
          <h2 className="caps" id="grabs">
            Every grab
          </h2>
          <span>
            {rows.length} / {p.shares}
          </span>
        </div>
        <ol>
          {shown.map((g, i) => (
            <li className="ledger__row" key={g.deviceKey}>
              <span className="ledger__n">{String(i + 1).padStart(2, '0')}</span>
              <span className="ledger__who">
                {g.claimerSkr ?? shortAddress(g.claimer)}
                <span className="caps ledger__meta">
                  {GRAB_LABEL[g.status]}
                  {p.luckKing === g.claimer && g.amount !== null && g.amount === p.luckKingAmount ? (
                    <>
                      {' · '}
                      <b>Luck King</b>
                    </>
                  ) : null}
                </span>
              </span>
              {g.amount === null ? (
                <span className="ledger__amount ledger__amount--pending" aria-hidden="true">
                  …
                </span>
              ) : (
                <span className="ledger__amount">{shareUi(g.amount, decimals)}</span>
              )}
            </li>
          ))}
        </ol>
        {rows.length > shown.length ? <p className="ledger__rest">and {rows.length - shown.length} more, in the app.</p> : null}
      </div>
    </section>
  );
}

export default async function PacketPage({ params }: Props) {
  const { packet } = await params;
  const p = await loadPacketPage(packet);
  if (!p) notFound();
  const copy = packetCopy(p);
  const open = copy.state === 'live' || copy.state === 'scheduled';
  const actionUrl = `${baseUrl()}/api/actions/grab/${packet}`;
  // the crown is final once every share is drawn, or the packet closed with shares left
  const settled = p.resolved >= p.shares || p.status === 'closed';
  return (
    <div className={open ? 'packet-page' : 'packet-page packet-page--spent'}>
      <header className="wrap masthead">
        <Wordmark href="/" />
        <p className="caps caps--quiet">Solana devnet</p>
      </header>

      <main className="wrap">
        <div className="packet">
          <div className="packet__envelope">
            <Envelope
              id="packet"
              className={open ? 'envelope--sheen' : undefined}
              tone={open ? (isSkin(p.skin) ? p.skin : 'shu') : 'ash'}
              shares={p.shares}
              left={copy.left}
              amount={copy.amountUi}
              caption={`${copy.symbol} · ${p.shares} ${p.shares === 1 ? 'share' : 'shares'}`}
            />
          </div>

          <div className="packet__body">
            <p className="caps caps--quiet">{copy.kind}</p>
            <h1 className="packet__title">
              <span className="packet__amount">
                {copy.amountUi}
                <small className="caps">{copy.symbol}</small>
              </span>
              <span className="packet__from">from {copy.who}</span>
            </h1>

            <div className="packet__badges">
              {p.seekerOnly ? (
                <span className="caps badge badge--jade">
                  <Check />
                  {copy.gate}
                </span>
              ) : (
                <span className="caps badge">{copy.gate}</span>
              )}
              <span className="packet__gate">{copy.gateNote}</span>
            </div>

            {p.message ? <p className="packet__message">&ldquo;{p.message}&rdquo;</p> : null}

            <State p={p} copy={copy} />

            {open && p.codeHint ? <p className="packet__hint">It opens with a code word. The sender&rsquo;s hint: {p.codeHint}</p> : null}

            {open ? (
              <div className="packet__open">
                <a className="btn btn--primary" href={`bao://packet/${packet}`}>
                  Open in Bao
                </a>
              </div>
            ) : null}
            <div className="packet__actions">
              {open ? null : (
                <a className="btn btn--ghost" href={`bao://packet/${packet}`}>
                  Open in Bao
                </a>
              )}
              <a className="btn btn--ghost" href={LINKS.release}>
                Get the Android app
              </a>
            </div>
            <p className="packet__hint">
              {open ? 'No app yet? Install it, then open this link again. ' : null}
              {copy.state === 'live' ? (
                <a className="link" href={`https://dial.to/?action=solana-action:${encodeURIComponent(actionUrl)}&cluster=devnet`}>
                  {p.seekerOnly ? 'Or grab from a Solana wallet that holds a Genesis Token' : 'Or grab with any Solana wallet'}
                </a>
              ) : null}
              {!open ? (
                <a className="link" href="/">
                  What Bao is
                </a>
              ) : null}
            </p>
          </div>
        </div>

        {p.grabs.length > 0 || p.luckKing ? (
          <div className="packet__more">
            {p.mode === 'lucky' && p.luckKing && p.luckKingAmount ? (
              <div className="king">
                <span className="king__seal" lang="zh-Hant" aria-hidden="true">
                  運氣王
                </span>
                <p className="king__who">
                  <span className="caps">{settled ? 'Luck King' : 'Luck King so far'}</span>
                  <span className="king__name">{p.luckKingSkr ?? shortAddress(p.luckKing)}</span>
                </p>
                <p className="king__amount">{shareUi(p.luckKingAmount, p.token.decimals)}</p>
              </div>
            ) : null}
            {p.grabs.length > 0 ? <Ledger p={p} /> : null}
          </div>
        ) : null}
      </main>

      <footer className="wrap footnote">
        <p>
          On Solana devnet.{' '}
          <a className="link" href={explorerAddress(packet)}>
            The packet&rsquo;s account on the explorer
          </a>
        </p>
        <p>{copy.mode}</p>
      </footer>
    </div>
  );
}
