/** "Bao | 紅包", as the app's header sets it. Sized by the font-size of whatever holds it. */
export function Wordmark({ href }: { href?: string }) {
  const inner = (
    <>
      <span className="wordmark__bao">Bao</span>
      <span className="wordmark__rule" aria-hidden="true" />
      <span className="wordmark__cjk" lang="zh-Hant">
        紅包
      </span>
    </>
  );
  return href ? (
    <a className="wordmark" href={href} aria-label="Bao 紅包, home">
      {inner}
    </a>
  ) : (
    <span className="wordmark">{inner}</span>
  );
}

/** Where the project lives; the landing page and the packet page link to the same places. */
export const LINKS = {
  repo: 'https://github.com/RaYYeR220/bao',
  release: 'https://github.com/RaYYeR220/bao/releases/latest',
  proof: 'https://github.com/RaYYeR220/bao/blob/main/PROOF.md',
  threatModel: 'https://github.com/RaYYeR220/bao/blob/main/THREAT_MODEL.md',
  judges: 'https://github.com/RaYYeR220/bao/blob/main/JUDGES.md',
  limits: 'https://github.com/RaYYeR220/bao#honest-limits',
} as const;

export const explorerAddress = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;
