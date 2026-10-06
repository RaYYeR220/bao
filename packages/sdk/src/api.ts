/**
 * Contract between the Bao app and the Bao API (apps/web). Amounts are base units as
 * decimal strings; times are unix seconds; addresses are base58.
 */

export type Base58 = string;
export type AmountString = string;

export type SplitModeName = 'lucky' | 'equal';
export type AudienceName = 'open' | 'circle' | 'code';
export type PacketStatus = 'scheduled' | 'live' | 'emptied' | 'expired' | 'closed';
export type GrabStatus = 'pending' | 'won' | 'paid' | 'forfeited';

export interface TokenInfo {
  mint: Base58;
  symbol: string;
  decimals: number;
  /** USD price per whole token when known (SKR priced from mainnet via Jupiter). */
  usd: number | null;
}

export interface UserView {
  address: Base58;
  /** Primary `.skr` name read from mainnet, if any. */
  skrName: string | null;
  /** Holds a real Seeker Genesis Token on mainnet. */
  seekerOnMainnet: boolean;
  /** Test Genesis token on devnet (the group the devnet program checks). */
  devnetGenesisMint: Base58 | null;
}

export interface PacketView {
  address: Base58;
  sender: Base58;
  senderSkr: string | null;
  token: TokenInfo;
  total: AmountString;
  remaining: AmountString;
  shares: number;
  reserved: number;
  resolved: number;
  mode: SplitModeName;
  audience: AudienceName;
  seekerOnly: boolean;
  startsAt: number;
  expiresAt: number;
  createdAt: number;
  status: PacketStatus;
  message: string | null;
  skin: string | null;
  circleId: string | null;
  /** Shown for code packets; the code itself is never stored. */
  codeHint: string | null;
  chainRoot: Base58;
  chainDepth: number;
  luckKing: Base58 | null;
  luckKingSkr: string | null;
  luckKingAmount: AmountString | null;
  createSignature: string | null;
}

export interface GrabView {
  packet: Base58;
  claimer: Base58;
  claimerSkr: string | null;
  deviceKey: Base58;
  index: number;
  amount: AmountString | null;
  status: GrabStatus;
  grabSignature: string | null;
  callbackSignature: string | null;
  payoutSignature: string | null;
  /** VRF randomness (hex) once the callback landed. */
  randomness: string | null;
  at: number;
}

export interface PacketDetail extends PacketView {
  grabs: GrabView[];
}

export interface CircleMember {
  address: Base58;
  skrName: string | null;
  joinedAt: number;
}

export interface CircleSummary {
  id: string;
  name: string;
  emoji: string | null;
  memberCount: number;
  livePackets: number;
}

export interface CircleDetail extends CircleSummary {
  inviteCode: string;
  owner: Base58;
  members: CircleMember[];
  packets: PacketView[];
  /** Luck King chains started in this circle, longest first. */
  chains: { root: Base58; depth: number; lastKing: Base58 | null; lastKingSkr: string | null }[];
  leaderboard: {
    generous: { address: Base58; skrName: string | null; total: AmountString }[];
    lucky: { address: Base58; skrName: string | null; crowns: number }[];
  };
}

export interface FeedView {
  /** Live and scheduled packets the viewer can grab, soonest first. */
  packets: PacketView[];
  /** Upcoming public rains. */
  rains: PacketView[];
}

export interface WidgetView {
  waiting: number;
  waitingAmountUi: string;
  symbol: string;
  nextRainAt: number | null;
  topPacket: Base58 | null;
}

export interface SignInInput {
  domain: string;
  address: Base58;
  statement: string;
  uri: string;
  version: '1';
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

export interface SignInOutput {
  address: Base58;
  /** base64 */
  signedMessage: string;
  /** base64 */
  signature: string;
}

export interface FaucetResult {
  sol: string | null;
  tskr: string | null;
  genesis: { mint: Base58; signature: string } | null;
}

export type PushKind = 'packet_dropped' | 'rain_starting' | 'packet_emptied' | 'luck_king' | 'paid_out';

export interface Endpoints {
  'POST /api/auth/nonce': { body: { address: Base58 }; res: SignInInput };
  'POST /api/auth/verify': { body: { input: SignInInput; output: SignInOutput }; res: { token: string; user: UserView } };
  'GET /api/me': { res: UserView };
  'POST /api/faucet': { body: Record<string, never>; res: FaucetResult };
  'GET /api/feed': { res: FeedView };
  'GET /api/widget': { res: WidgetView };
  'POST /api/packets': {
    body: { address: Base58; message?: string; skin?: string; circleId?: string; snapshotRoot?: string; codeHint?: string };
    res: PacketView;
  };
  'GET /api/packets/:address': { res: PacketDetail };
  'GET /api/packets/:address/proof': { query: { wallet: Base58 }; res: { proof: string[] } };
  'GET /api/circles': { res: CircleSummary[] };
  'POST /api/circles': { body: { name: string; emoji?: string }; res: CircleDetail };
  'POST /api/circles/join': { body: { inviteCode: string }; res: CircleDetail };
  'GET /api/circles/:id': { res: CircleDetail };
  'POST /api/circles/:id/snapshot': { body: Record<string, never>; res: { root: string; members: Base58[] } };
  'GET /api/users/:address': { res: UserView & { sent: PacketView[]; grabs: GrabView[]; crowns: number } };
  'POST /api/push/register': { body: { fcmToken: string }; res: { ok: true } };
}

type Path<K> = K extends `${string} ${infer P}` ? P : never;

/** Minimal typed client. `token` is the session JWT from /api/auth/verify. */
export function createBaoApi(baseUrl: string, getToken: () => string | null) {
  async function call<K extends keyof Endpoints>(
    key: K,
    opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
  ): Promise<Endpoints[K]['res']> {
    const [method, rawPath] = (key as string).split(' ') as [string, Path<K>];
    let path: string = rawPath;
    for (const [k, v] of Object.entries(opts.params ?? {})) path = path.replace(`:${k}`, encodeURIComponent(v));
    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : '';
    const token = getToken();
    const res = await fetch(`${baseUrl}${path}${qs}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${key} → ${res.status}: ${text}`);
    }
    return (await res.json()) as Endpoints[K]['res'];
  }
  return { call };
}
