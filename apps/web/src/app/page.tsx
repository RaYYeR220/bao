import type { Metadata } from 'next';
import { BAO_PROGRAM_ADDRESS } from '@bao/sdk';
import { landingStats } from '@/lib/landing';
import { LINKS, Wordmark, explorerAddress } from '@/ui/wordmark';

/** Static, with the live numbers refreshed every five minutes. */
export const revalidate = 300;

const TITLE = 'Bao 紅包 · Red packets for Seeker';
const SUMMARY = 'One Seeker, one grab. Red packets of tSKR that a farm of wallets cannot drain: the Solana program binds every grab to a Seeker Genesis Token.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description:
    'Drop a red packet of tSKR into the public feed, a circle or behind a code word. People shake their phone to grab a share, and the Solana program binds each grab to a Seeker Genesis Token: one Seeker, one grab. Live on devnet.',
  alternates: { canonical: '/' },
  openGraph: { title: TITLE, description: SUMMARY, url: '/', siteName: 'Bao', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: SUMMARY },
};

/** Every screenshot is 405 by 900, so its box is known before it loads. */
function Phone({ src, alt, small, eager }: { src: string; alt: string; small?: boolean; eager?: boolean }) {
  return (
    <figure className={small ? 'phone phone--sm' : 'phone'}>
      <img
        src={`/shots/${src}.jpg`}
        alt={alt}
        width={405}
        height={900}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        decoding="async"
      />
    </figure>
  );
}

const STEPS = [
  {
    title: 'Drop',
    shot: 'seal',
    alt: 'Sealing a packet in the app: the envelope, three skins to pick from, and a summary reading 8 tSKR, one per Seeker, returns after 24 hours.',
    text: 'Pick an amount, the number of shares, Lucky or Equal, and who it is for: the public feed, a circle, or anyone with a code word. One signature moves the tokens into a vault the packet owns.',
  },
  {
    title: 'Shake',
    shot: 'shake',
    alt: 'A red envelope tilting on screen under the words Shake to open, 2 of 3.',
    text: 'Three shakes open it. The program checks the Seeker Genesis Token, records the grab under that token rather than the wallet, and reserves a share.',
  },
  {
    title: 'Reveal',
    shot: 'luck-king',
    alt: 'A paper card reading You grabbed 19.9 tSKR, with links to the grab transaction, the randomness proof and the payout.',
    text: 'A Lucky packet asks MagicBlock VRF for a random value. About two seconds later the share is drawn on-chain, with a proof you can open. An Equal packet pays at once.',
  },
  {
    title: 'Pass it on',
    shot: 'next-in-chain',
    alt: 'Sending the next packet: 88 tSKR in 8 shares, marked number 2 in the chain.',
    text: 'The biggest grab is crowned Luck King. Only the holder of that crown can send the next packet in the chain.',
  },
];

const REFUSALS = [
  {
    code: '6013',
    name: 'NotASeeker',
    href: `${LINKS.proof}#refusals-the-part-bots-meet`,
    text: 'The grabbing wallet holds no Seeker Genesis Token. Nothing moves.',
  },
  {
    code: '6016',
    name: 'AlreadyGrabbedOnThisDevice',
    href: `${LINKS.proof}#refusals-the-part-bots-meet`,
    text: 'The same Genesis Token was moved to a second wallet, which tried again. The grab is recorded under the token, so the second wallet gets nothing.',
  },
  {
    code: '6012',
    name: 'WrongCode',
    href: `${LINKS.proof}#from-the-app`,
    text: 'A code-word packet was tried with the wrong word.',
  },
];

const FEATURES = [
  ['Seeker Genesis Token', 'The sybil filter. The program checks it on every Seeker-only grab and files the grab under the token.'],
  ['Seed Vault', 'On a Seeker, the built-in wallet signs each drop and grab through Mobile Wallet Adapter.'],
  ['Shake and haptics', 'Opening a packet is a gesture: three shakes, each one felt and heard.'],
  ['NFC and QR', 'A packet is a link. Send it, show it as a QR code, or write it to an NFC tag to hand it out in person.'],
  ['Home-screen widget', 'Shows how many packets are waiting for you and how much they hold.'],
  ['Push', 'A packet landed in your circle. A rain is about to start. Your share arrived.'],
  ['.skr names', 'Senders and grabbers appear by their .skr name wherever they have one.'],
];

function GetTheApp() {
  return (
    <div className="hero__cta">
      <a className="btn btn--primary" href={LINKS.release}>
        Get the Android app
      </a>
      <a className="btn btn--ghost" href={LINKS.repo}>
        View the code
      </a>
    </div>
  );
}

export default async function Home() {
  const stats = await landingStats();
  return (
    <>
      <header className="wrap masthead">
        <p className="caps live">Live on Solana devnet</p>
        <nav className="masthead__nav" aria-label="Project">
          <a href={LINKS.proof}>Proof</a>
          <a href={LINKS.repo}>Code</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="wrap hero__grid">
            <div>
              <h1 className="hero__title">
                <Wordmark />
                <span className="hero__tagline">
                  Red packets for Seeker. <em>One Seeker, one grab.</em>
                </span>
              </h1>
              <p className="hero__lede">
                Drop tSKR into the public feed, a circle of friends, or behind a code word. People shake their phone to grab a share.
                The Solana program binds each grab to the phone&rsquo;s Seeker Genesis Token, so one device grabs once, however many
                wallets it holds.
              </p>
              <GetTheApp />
              <p className="hero__fine">
                An Android APK from GitHub Releases. It runs on Solana devnet, and the Playground in the app hands out test SOL, tSKR
                and a test Genesis Token.
              </p>
            </div>
            <div className="hero__phones">
              <Phone
                src="feed"
                eager
                alt="The Bao feed on a phone: packets as red, black and jade envelopes. The one in front holds 168 tSKR in 8 shares and closes in 23 hours."
              />
              <Phone
                src="grabbed"
                eager
                alt="A grabbed share: a paper card reading 19.85 tSKR, Luck King so far, stamped with the red 運氣王 seal."
              />
            </div>
          </div>
        </section>

        <hr className="foil-rule" />

        <section className="section">
          <div className="wrap">
            <p className="statement">
              <span>Every crypto giveaway gets farmed: one person, a thousand wallets.</span> A Bao packet counts Seekers, not wallets,
              and the counting is done by the program, not by a server.
            </p>
          </div>
        </section>

        <hr className="foil-rule" />

        <section className="section" aria-labelledby="how">
          <div className="wrap">
            <div className="section__head">
              <h2 className="h2" id="how">
                How a packet works
              </h2>
            </div>
            <ol className="steps">
              {STEPS.map((step, i) => (
                <li className="step" key={step.title}>
                  <Phone small src={step.shot} alt={step.alt} />
                  <div className="step__text">
                    <h3 className="step__title">
                      <span className="step__num">{i + 1}</span>
                      {step.title}
                    </h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <hr className="foil-rule" />

        <section className="section" aria-labelledby="refused">
          <div className="wrap refused">
            <div className="refused__body">
              <h2 className="h2" id="refused">
                Refused by the program
              </h2>
              <p className="section__intro">
                The checks are in the Solana program, not on a server. The app runs each grab against the program before the wallet
                opens, so a grab that would be refused costs no fee and shows the program&rsquo;s own error code.
              </p>
              <ul className="refusals">
                {REFUSALS.map((r) => (
                  <li className="refusal" key={r.code}>
                    <span className="refusal__code">{r.code}</span>
                    <a className="caps refusal__name link" href={r.href}>
                      {r.name}
                    </a>
                    <p className="refusal__what">{r.text}</p>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="refused__shot">
              <div className="phone">
                <img
                  src="/shots/refused-6013.jpg"
                  alt="Screenshot from a Samsung Galaxy A52. Under a red envelope, a card reads: Refused by the program. Only real Seekers can open this. Error 6013, NotASeeker."
                  width={405}
                  height={900}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <figcaption>
                A Samsung Galaxy A52 with a fresh Phantom wallet and no Genesis Token. Nothing was signed or sent.{' '}
                <a className="link" href={`${LINKS.proof}#on-a-real-phone`}>
                  The run, step by step
                </a>
              </figcaption>
            </figure>
          </div>
        </section>

        <hr className="foil-rule" />

        <section className="section" aria-labelledby="seeker">
          <div className="wrap seeker">
            <div>
              <div className="section__head">
                <h2 className="h2" id="seeker">
                  Only makes sense on a Seeker
                </h2>
              </div>
              <dl>
                {FEATURES.map(([term, what]) => (
                  <div className="feature" key={term}>
                    <dt>{term}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
              <p className="seeker__note">
                Built for Seeker, and so far run on a Galaxy A52 with Phantom and on an emulator, not on a Seeker itself.{' '}
                <a className="link" href={LINKS.limits}>
                  The honest limits
                </a>
              </p>
            </div>
            <div className="seeker__visual">
              <Phone src="share" alt="A sealed packet in the app: its link, a Share the link button and a QR code under the words Scan to grab." />
              <img
                className="seeker__widget"
                src="/shots/widget.jpg"
                alt="The Bao home-screen widget: 3 packets waiting, 274 tSKR."
                width={720}
                height={446}
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </section>

        {stats ? (
          <>
            <hr className="foil-rule" />
            <section className="section" aria-labelledby="numbers">
              <div className="wrap">
                <div className="section__head">
                  <h2 className="h2" id="numbers">
                    On devnet so far
                  </h2>
                </div>
                <ul className="stats">
                  <li className="stat">
                    <span className="stat__value">{stats.packets}</span>
                    <span className="caps caps--quiet stat__label">packets dropped</span>
                  </li>
                  <li className="stat">
                    <span className="stat__value">{stats.grabs}</span>
                    <span className="caps caps--quiet stat__label">grabs</span>
                  </li>
                  <li className="stat">
                    <span className="stat__value">{stats.paid}</span>
                    <span className="caps caps--quiet stat__label">{stats.symbol} paid to grabbers</span>
                  </li>
                </ul>
                <p className="stats__note">
                  Counted from the program&rsquo;s own events. {stats.symbol} is the devnet stand-in for SKR.
                  {stats.house ? ` ${stats.house} of the packets came from the house rain that keeps the public feed stocked.` : null}
                </p>
              </div>
            </section>
          </>
        ) : null}

        <hr className="foil-rule" />

        <section className="section" aria-labelledby="try">
          <div className="wrap try">
            <div>
              <h2 className="h2" id="try">
                Try it without a Seeker
              </h2>
              <p className="section__intro">
                Install the APK on any Android phone with a Solana wallet. On devnet the Playground gives your wallet test SOL, tSKR
                and a test Genesis Token, so you can drop and grab the whole way through. Skip it, and every Seeker-only packet refuses
                you.
              </p>
            </div>
            <GetTheApp />
          </div>
        </section>
      </main>

      <hr className="foil-rule" />

      <footer className="wrap footer">
        <div className="footer__program">
          <p className="caps live">Live on Solana devnet</p>
          <p>
            Program{' '}
            <a className="link footer__address" href={explorerAddress(BAO_PROGRAM_ADDRESS)}>
              {BAO_PROGRAM_ADDRESS}
            </a>
          </p>
        </div>
        <nav className="footer__links" aria-label="Documents">
          <a href={LINKS.proof}>PROOF.md</a>
          <a href={LINKS.threatModel}>THREAT_MODEL.md</a>
          <a href={LINKS.judges}>JUDGES.md</a>
          <a href={LINKS.repo}>GitHub</a>
        </nav>
      </footer>
    </>
  );
}
