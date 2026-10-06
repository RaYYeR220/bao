/**
 * All database access. `Sql` is the only thing that knows about the driver: node-postgres
 * against Supabase (DATABASE_URL) or an embedded PGlite for local runs and tests.
 */
import type { GrabStatus, PacketStatus } from '@bao/sdk';
import { env } from './env';
import { log } from './log';
import type { CircleRecord, GrabPatch, GrabRecord, IdentityRecord, PacketMirror, PacketRecord } from './types';

export type Row = Record<string, unknown>;

export interface Sql {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

export async function connectPg(url: string): Promise<Sql> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    // Supabase serves its own CA: pass it in DATABASE_CA_CERT, or use the URL's sslmode
    ssl: env().DATABASE_CA_CERT ? { ca: env().DATABASE_CA_CERT, rejectUnauthorized: true } : undefined,
  });
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      const res = await pool.query(text, params);
      return res.rows as T[];
    },
    async exec(text) {
      await pool.query(text);
    },
    close: () => pool.end(),
  };
}

export async function connectPglite(dir?: string): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dir ? new PGlite(dir) : new PGlite();
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      const res = await db.query<T>(text, params);
      return res.rows;
    },
    async exec(text) {
      await db.exec(text);
    },
    close: () => db.close(),
  };
}

let shared: Promise<Store> | null = null;

/** The process-wide store; falls back to an in-memory PGlite when DATABASE_URL is unset. */
export function getStore(): Promise<Store> {
  if (!shared) {
    shared = (async () => {
      const { DATABASE_URL, PGLITE_DIR } = env();
      if (DATABASE_URL) return new Store(await connectPg(DATABASE_URL));
      log.once('db.fallback_pglite', { note: 'DATABASE_URL unset; using embedded PGlite', dir: PGLITE_DIR ?? 'memory' });
      const sql = await connectPglite(PGLITE_DIR);
      const { migrate } = await import('./migrate');
      await migrate(sql);
      return new Store(sql);
    })();
    shared.catch(() => {
      shared = null;
    });
  }
  return shared;
}

export function setStore(store: Store | null) {
  shared = store ? Promise.resolve(store) : null;
}

// ---------- row mapping ----------

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const secs = (v: unknown): number | null => (v instanceof Date ? Math.floor(v.getTime() / 1000) : numOrNull(v));

function toPacket(r: Row): PacketRecord {
  return {
    address: str(r.address),
    sender: str(r.sender),
    packetId: strOrNull(r.packet_id),
    mint: str(r.mint),
    tokenProgram: strOrNull(r.token_program),
    decimals: numOrNull(r.decimals),
    totalAmount: str(r.total_amount),
    remainingAmount: str(r.remaining_amount),
    totalShares: num(r.total_shares),
    reserved: num(r.reserved),
    resolved: num(r.resolved),
    mode: r.mode as PacketRecord['mode'],
    audience: r.audience as PacketRecord['audience'],
    merkleRoot: strOrNull(r.merkle_root),
    seekerOnly: Boolean(r.seeker_only),
    createdAt: num(r.created_at),
    startsAt: num(r.starts_at),
    expiresAt: num(r.expires_at),
    messageHash: strOrNull(r.message_hash),
    parent: strOrNull(r.parent),
    chainRoot: str(r.chain_root),
    chainDepth: num(r.chain_depth),
    luckKing: strOrNull(r.luck_king),
    luckKingAmount: strOrNull(r.luck_king_amount),
    crowned: Boolean(r.crowned),
    status: r.status as PacketStatus,
    message: strOrNull(r.message),
    skin: strOrNull(r.skin),
    circleId: strOrNull(r.circle_id),
    snapshotRoot: strOrNull(r.snapshot_root),
    codeHint: strOrNull(r.code_hint),
    registered: r.registered_at !== null && r.registered_at !== undefined,
    createSignature: strOrNull(r.create_signature),
    closeSignature: strOrNull(r.close_signature),
    refunded: strOrNull(r.refunded),
    droppedPushed: r.dropped_push_at !== null && r.dropped_push_at !== undefined,
    rainPushed: r.rain_push_at !== null && r.rain_push_at !== undefined,
    emptiedPushed: r.emptied_push_at !== null && r.emptied_push_at !== undefined,
  };
}

function toGrab(r: Row): GrabRecord {
  return {
    packet: str(r.packet),
    deviceKey: str(r.device_key),
    claimer: str(r.claimer),
    index: num(r.claim_index),
    amount: strOrNull(r.amount),
    status: r.status as GrabStatus,
    grabSignature: strOrNull(r.grab_signature),
    callbackSignature: strOrNull(r.callback_signature),
    payoutSignature: strOrNull(r.payout_signature),
    randomness: strOrNull(r.randomness),
    slot: num(r.slot),
    at: num(r.at),
  };
}

function toCircle(r: Row): CircleRecord {
  return {
    id: str(r.id),
    name: str(r.name),
    emoji: strOrNull(r.emoji),
    inviteCode: str(r.invite_code),
    owner: str(r.owner),
    createdAt: secs(r.created_at) ?? 0,
  };
}

// numeric columns come back as strings from both drivers
const PACKET_COLUMNS = '*';

/** Status order: a later event never moves a claim backwards. */
const STATUS_RANK = `case $S when 'pending' then 0 when 'won' then 1 when 'paid' then 2 when 'forfeited' then 2 end`;
const rank = (expr: string) => STATUS_RANK.replace('$S', expr);

export class Store {
  constructor(readonly sql: Sql) {}

  // ---------- users / identity ----------

  async ensureUser(address: string) {
    await this.sql.query('insert into users (address) values ($1) on conflict (address) do nothing', [address]);
  }

  async ensureUsers(addresses: string[]) {
    if (addresses.length === 0) return;
    await this.sql.query('insert into users (address) select unnest($1::text[]) on conflict (address) do nothing', [addresses]);
  }

  async markSignedIn(address: string) {
    await this.sql.query(
      'insert into users (address, signed_in_at) values ($1, now()) on conflict (address) do update set signed_in_at = now()',
      [address],
    );
  }

  async getIdentity(address: string): Promise<IdentityRecord | null> {
    const [r] = await this.sql.query('select * from users where address = $1', [address]);
    if (!r) return null;
    return {
      address: str(r.address),
      skrName: strOrNull(r.skr_name),
      skrCheckedAt: secs(r.skr_checked_at),
      seekerMainnet: Boolean(r.seeker_mainnet),
      seekerCheckedAt: secs(r.seeker_checked_at),
      devnetGenesisMint: strOrNull(r.devnet_genesis_mint),
      genesisCheckedAt: secs(r.genesis_checked_at),
    };
  }

  async saveSkr(address: string, name: string | null) {
    await this.sql.query(
      `insert into users (address, skr_name, skr_checked_at) values ($1, $2, now())
       on conflict (address) do update set skr_name = $2, skr_checked_at = now()`,
      [address, name],
    );
  }

  async saveSeeker(address: string, seeker: boolean) {
    await this.sql.query(
      `insert into users (address, seeker_mainnet, seeker_checked_at) values ($1, $2, now())
       on conflict (address) do update set seeker_mainnet = $2, seeker_checked_at = now()`,
      [address, seeker],
    );
  }

  async saveDevnetGenesis(address: string, mint: string | null) {
    await this.sql.query(
      `insert into users (address, devnet_genesis_mint, genesis_checked_at) values ($1, $2, now())
       on conflict (address) do update set devnet_genesis_mint = $2, genesis_checked_at = now()`,
      [address, mint],
    );
  }

  /** Cached `.skr` names only; never triggers a chain read. */
  async skrNames(addresses: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(addresses.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.sql.query<{ address: string; skr_name: string }>(
      'select address, skr_name from users where address = any($1::text[]) and skr_name is not null',
      [unique],
    );
    return new Map(rows.map((r) => [r.address, r.skr_name]));
  }

  // ---------- sign-in nonces ----------

  async createNonce(nonce: string, address: string, input: unknown, expiresAt: Date) {
    await this.sql.query('insert into auth_nonces (nonce, address, input, expires_at) values ($1, $2, $3::jsonb, $4)', [
      nonce,
      address,
      JSON.stringify(input),
      expiresAt.toISOString(),
    ]);
  }

  /** Marks the nonce used and returns its stored input; null when unknown, used or expired. */
  async consumeNonce(nonce: string): Promise<{ address: string; input: unknown } | null> {
    const [r] = await this.sql.query(
      `update auth_nonces set used_at = now()
       where nonce = $1 and used_at is null and expires_at > now()
       returning address, input`,
      [nonce],
    );
    if (!r) return null;
    return { address: str(r.address), input: typeof r.input === 'string' ? JSON.parse(r.input) : r.input };
  }

  async pruneNonces() {
    await this.sql.query("delete from auth_nonces where expires_at < now() - interval '1 day'");
  }

  // ---------- circles ----------

  async createCircle(c: { name: string; emoji: string | null; owner: string; inviteCode: string }): Promise<CircleRecord> {
    await this.ensureUser(c.owner);
    const [r] = await this.sql.query(
      'insert into circles (name, emoji, owner, invite_code) values ($1, $2, $3, $4) returning *',
      [c.name, c.emoji, c.owner, c.inviteCode],
    );
    await this.addMember(str(r.id), c.owner);
    return toCircle(r);
  }

  async addMember(circleId: string, address: string) {
    await this.ensureUser(address);
    await this.sql.query(
      'insert into circle_members (circle_id, address) values ($1, $2) on conflict do nothing',
      [circleId, address],
    );
  }

  async getCircle(id: string): Promise<CircleRecord | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [r] = await this.sql.query('select * from circles where id = $1', [id]);
    return r ? toCircle(r) : null;
  }

  async circleByInvite(code: string): Promise<CircleRecord | null> {
    const [r] = await this.sql.query('select * from circles where invite_code = $1', [code]);
    return r ? toCircle(r) : null;
  }

  async isMember(circleId: string, address: string): Promise<boolean> {
    const rows = await this.sql.query('select 1 from circle_members where circle_id = $1 and address = $2', [circleId, address]);
    return rows.length > 0;
  }

  async members(circleId: string): Promise<{ address: string; joinedAt: number }[]> {
    const rows = await this.sql.query(
      'select address, joined_at from circle_members where circle_id = $1 order by joined_at, address',
      [circleId],
    );
    return rows.map((r) => ({ address: str(r.address), joinedAt: secs(r.joined_at) ?? 0 }));
  }

  async circlesOf(address: string, now: number) {
    const rows = await this.sql.query(
      `select c.*,
         (select count(*) from circle_members m2 where m2.circle_id = c.id) as member_count,
         (select count(*) from packets p where p.circle_id = c.id and p.status not in ('closed')
            and p.expires_at > $2 and p.reserved < p.total_shares) as live_packets
       from circles c join circle_members m on m.circle_id = c.id
       where m.address = $1
       order by m.joined_at desc`,
      [address, now],
    );
    return rows.map((r) => ({ ...toCircle(r), memberCount: num(r.member_count), livePackets: num(r.live_packets) }));
  }

  async circleCounts(circleId: string, now: number) {
    const [r] = await this.sql.query(
      `select (select count(*) from circle_members where circle_id = $1) as member_count,
              (select count(*) from packets p where p.circle_id = $1 and p.status not in ('closed')
                 and p.expires_at > $2 and p.reserved < p.total_shares) as live_packets`,
      [circleId, now],
    );
    return { memberCount: num(r?.member_count), livePackets: num(r?.live_packets) };
  }

  async saveSnapshot(circleId: string, root: string, members: string[]) {
    await this.sql.query(
      'insert into circle_snapshots (circle_id, root, members) values ($1, $2, $3::text[]) on conflict do nothing',
      [circleId, root, members],
    );
  }

  async snapshot(root: string, circleId?: string | null): Promise<{ circleId: string; members: string[] } | null> {
    const rows = circleId
      ? await this.sql.query('select circle_id, members from circle_snapshots where root = $1 and circle_id = $2', [root, circleId])
      : await this.sql.query('select circle_id, members from circle_snapshots where root = $1 order by created_at desc limit 1', [root]);
    const r = rows[0];
    return r ? { circleId: str(r.circle_id), members: (r.members as string[]).map(String) } : null;
  }

  async circlePackets(circleId: string, limit = 50): Promise<PacketRecord[]> {
    const rows = await this.sql.query(
      `select ${PACKET_COLUMNS} from packets where circle_id = $1 order by created_at desc limit $2`,
      [circleId, limit],
    );
    return rows.map(toPacket);
  }

  async circleChains(circleId: string) {
    const rows = await this.sql.query(
      `select distinct on (chain_root) chain_root, chain_depth, luck_king
       from packets where circle_id = $1
       order by chain_root, chain_depth desc, created_at desc`,
      [circleId],
    );
    return rows
      .map((r) => ({ root: str(r.chain_root), depth: num(r.chain_depth), lastKing: strOrNull(r.luck_king) }))
      .sort((a, b) => b.depth - a.depth);
  }

  async circleLeaderboards(circleId: string, limit = 10) {
    const generous = await this.sql.query(
      `select sender as address, sum(total_amount)::text as total from packets
       where circle_id = $1 group by sender order by sum(total_amount) desc, sender limit $2`,
      [circleId, limit],
    );
    const lucky = await this.sql.query(
      `select luck_king as address, count(*) as crowns from packets
       where circle_id = $1 and luck_king is not null and crowned group by luck_king
       order by count(*) desc, luck_king limit $2`,
      [circleId, limit],
    );
    return {
      generous: generous.map((r) => ({ address: str(r.address), total: str(r.total) })),
      lucky: lucky.map((r) => ({ address: str(r.address), crowns: num(r.crowns) })),
    };
  }

  // ---------- packets ----------

  /** Writes what the chain says; app metadata and push bookkeeping are left alone. */
  async upsertPacketMirror(m: PacketMirror, status: PacketStatus) {
    await this.sql.query(
      `insert into packets (address, sender, packet_id, mint, token_program, decimals, total_amount, remaining_amount,
         total_shares, reserved, resolved, mode, audience, merkle_root, seeker_only, created_at, starts_at, expires_at,
         message_hash, parent, chain_root, chain_depth, luck_king, luck_king_amount, crowned, status, create_signature)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,0),coalesce($11,0),$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
         coalesce($25,false),$26,$27)
       on conflict (address) do update set
         packet_id = coalesce(excluded.packet_id, packets.packet_id),
         token_program = coalesce(excluded.token_program, packets.token_program),
         decimals = coalesce(excluded.decimals, packets.decimals),
         remaining_amount = case when $10::int is null then packets.remaining_amount else excluded.remaining_amount end,
         reserved = coalesce($10, packets.reserved),
         resolved = coalesce($11, packets.resolved),
         merkle_root = coalesce(excluded.merkle_root, packets.merkle_root),
         created_at = excluded.created_at,
         starts_at = excluded.starts_at,
         expires_at = excluded.expires_at,
         message_hash = coalesce(excluded.message_hash, packets.message_hash),
         parent = coalesce(excluded.parent, packets.parent),
         luck_king = coalesce(excluded.luck_king, packets.luck_king),
         luck_king_amount = coalesce(excluded.luck_king_amount, packets.luck_king_amount),
         crowned = packets.crowned or excluded.crowned,
         status = case when packets.status = 'closed' then 'closed' else excluded.status end,
         create_signature = coalesce(packets.create_signature, excluded.create_signature),
         updated_at = now()`,
      [
        m.address,
        m.sender,
        m.packetId ?? null,
        m.mint,
        m.tokenProgram ?? null,
        m.decimals ?? null,
        m.totalAmount,
        m.remainingAmount,
        m.totalShares,
        m.reserved ?? null,
        m.resolved ?? null,
        m.mode,
        m.audience,
        m.merkleRoot ?? null,
        m.seekerOnly,
        m.createdAt,
        m.startsAt,
        m.expiresAt,
        m.messageHash ?? null,
        m.parent ?? null,
        m.chainRoot,
        m.chainDepth,
        m.luckKing ?? null,
        m.luckKingAmount ?? null,
        m.crowned ?? null,
        status,
        m.createSignature ?? null,
      ],
    );
  }

  /** Inserts an event-only mirror unless the packet is already known (the account read is better). */
  async insertPacketIfMissing(m: PacketMirror, status: PacketStatus): Promise<boolean> {
    if (await this.getPacket(m.address)) {
      if (m.createSignature) {
        await this.sql.query('update packets set create_signature = coalesce(create_signature, $2) where address = $1', [
          m.address,
          m.createSignature,
        ]);
      }
      return false;
    }
    await this.upsertPacketMirror(m, status);
    return true;
  }

  async registerPacket(
    address: string,
    meta: { message: string | null; skin: string | null; circleId: string | null; snapshotRoot: string | null; codeHint: string | null },
  ) {
    await this.sql.query(
      `update packets set message = $2, skin = $3, circle_id = $4, snapshot_root = $5, code_hint = $6,
         registered_at = coalesce(registered_at, now()), updated_at = now()
       where address = $1`,
      [address, meta.message, meta.skin, meta.circleId, meta.snapshotRoot, meta.codeHint],
    );
  }

  async getPacket(address: string): Promise<PacketRecord | null> {
    const [r] = await this.sql.query(`select ${PACKET_COLUMNS} from packets where address = $1`, [address]);
    return r ? toPacket(r) : null;
  }

  async setPacketStatus(address: string, status: PacketStatus) {
    await this.sql.query(
      `update packets set status = $2, updated_at = now() where address = $1 and status <> 'closed'`,
      [address, status],
    );
  }

  async markCrowned(address: string, king: string, amount: string) {
    await this.sql.query(
      'update packets set luck_king = $2, luck_king_amount = $3, crowned = true, updated_at = now() where address = $1',
      [address, king, amount],
    );
  }

  async markClosed(address: string, signature: string, refunded: string, luckKing: string | null) {
    await this.sql.query(
      `update packets set status = 'closed', close_signature = coalesce(close_signature, $2), refunded = $3,
         luck_king = coalesce($4, luck_king), updated_at = now()
       where address = $1`,
      [address, signature, refunded, luckKing],
    );
  }

  /** Atomically claims a one-time push flag; true only for the first caller. */
  async claimPushFlag(address: string, flag: 'dropped_push_at' | 'rain_push_at' | 'emptied_push_at'): Promise<boolean> {
    const rows = await this.sql.query(
      `update packets set ${flag} = now() where address = $1 and ${flag} is null returning address`,
      [address],
    );
    return rows.length > 0;
  }

  /**
   * Packets the viewer may grab now or soon: open packets for everyone, circle packets for
   * members. Excludes code packets (shared by link), closed, expired, emptied and already-grabbed ones.
   */
  async feed(viewer: string | null, now: number, limit = 100): Promise<PacketRecord[]> {
    const rows = await this.sql.query(
      `select ${PACKET_COLUMNS} from packets p
       where p.status <> 'closed' and p.expires_at > $2 and p.reserved < p.total_shares
         and (p.audience = 'open'
              or (p.audience = 'circle' and $1::text is not null and exists (
                    select 1 from circle_members m where m.circle_id = p.circle_id and m.address = $1)))
         and ($1::text is null or not exists (select 1 from grabs g where g.packet = p.address and g.claimer = $1))
       order by case when p.starts_at <= $2 then 0 else 1 end,
                case when p.starts_at <= $2 then p.expires_at else p.starts_at end,
                p.address
       limit $3`,
      [viewer, now, limit],
    );
    return rows.map(toPacket);
  }

  async upcomingRains(now: number, limit = 20): Promise<PacketRecord[]> {
    const rows = await this.sql.query(
      `select r.* from rains r where r.status <> 'closed' and r.starts_at > $1 order by r.starts_at, r.address limit $2`,
      [now, limit],
    );
    return rows.map(toPacket);
  }

  /** Rains opening before `until` whose start push has not gone out. */
  async rainsStartingBefore(until: number): Promise<PacketRecord[]> {
    const rows = await this.sql.query(
      `select ${PACKET_COLUMNS} from packets
       where audience = 'open' and starts_at > created_at and starts_at <= $1 and rain_push_at is null
         and status <> 'closed'
       order by starts_at limit 50`,
      [until],
    );
    return rows.map(toPacket);
  }

  async packetsBySender(sender: string, limit = 50): Promise<PacketRecord[]> {
    const rows = await this.sql.query(
      `select ${PACKET_COLUMNS} from packets where sender = $1 order by created_at desc limit $2`,
      [sender, limit],
    );
    return rows.map(toPacket);
  }

  async packetsByAddress(addresses: string[]): Promise<PacketRecord[]> {
    if (addresses.length === 0) return [];
    const rows = await this.sql.query(`select ${PACKET_COLUMNS} from packets where address = any($1::text[])`, [addresses]);
    return rows.map(toPacket);
  }

  /** Packets the chain may still hold (not seen closed). */
  async openPackets(limit = 500): Promise<PacketRecord[]> {
    const rows = await this.sql.query(
      `select ${PACKET_COLUMNS} from packets where status <> 'closed' order by expires_at limit $1`,
      [limit],
    );
    return rows.map(toPacket);
  }

  async crownCount(address: string): Promise<number> {
    const [r] = await this.sql.query('select count(*) as n from packets where luck_king = $1 and crowned', [address]);
    return num(r?.n);
  }

  // ---------- grabs ----------

  async applyGrab(g: GrabPatch) {
    await this.sql.query(
      `insert into grabs (packet, device_key, claimer, claim_index, amount, status, grab_signature, callback_signature,
         payout_signature, randomness, slot, at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,0),$12)
       on conflict (packet, device_key) do update set
         claimer = excluded.claimer,
         claim_index = case when excluded.slot >= grabs.slot then excluded.claim_index else grabs.claim_index end,
         amount = coalesce(excluded.amount, grabs.amount),
         status = case when ${rank('excluded.status')} > ${rank('grabs.status')} then excluded.status else grabs.status end,
         grab_signature = coalesce(excluded.grab_signature, grabs.grab_signature),
         callback_signature = coalesce(excluded.callback_signature, grabs.callback_signature),
         payout_signature = coalesce(excluded.payout_signature, grabs.payout_signature),
         randomness = coalesce(excluded.randomness, grabs.randomness),
         slot = greatest(grabs.slot, excluded.slot),
         at = least(grabs.at, excluded.at),
         updated_at = now()`,
      [
        g.packet,
        g.deviceKey,
        g.claimer,
        g.index,
        g.amount ?? null,
        g.status,
        g.grabSignature ?? null,
        g.callbackSignature ?? null,
        g.payoutSignature ?? null,
        g.randomness ?? null,
        g.slot ?? null,
        g.at,
      ],
    );
  }

  /** PaidOut names the claimer, not the device; settle that claimer's won share of this amount. */
  async markPaid(packet: string, claimer: string, amount: string, signature: string): Promise<number> {
    const rows = await this.sql.query(
      `update grabs set status = 'paid', payout_signature = coalesce(payout_signature, $4), updated_at = now()
       where packet = $1 and claimer = $2 and (amount = $3::numeric or amount is null) and status <> 'paid'
       returning packet`,
      [packet, claimer, amount, signature],
    );
    return rows.length;
  }

  /** A stale reservation was cancelled on-chain at `slot`; a newer re-grab is kept. */
  async cancelGrab(packet: string, deviceKey: string, slot: number) {
    await this.sql.query(
      "delete from grabs where packet = $1 and device_key = $2 and slot <= $3 and status = 'pending'",
      [packet, deviceKey, slot],
    );
  }

  async markForfeited(packet: string, claimer: string) {
    await this.sql.query(
      "update grabs set status = 'forfeited', updated_at = now() where packet = $1 and claimer = $2 and status = 'won'",
      [packet, claimer],
    );
  }

  async grabsOf(packet: string): Promise<GrabRecord[]> {
    const rows = await this.sql.query(
      'select * from grabs where packet = $1 order by claim_index, at',
      [packet],
    );
    return rows.map(toGrab);
  }

  async grabsByClaimer(claimer: string, limit = 50): Promise<GrabRecord[]> {
    const rows = await this.sql.query(
      'select * from grabs where claimer = $1 order by at desc limit $2',
      [claimer, limit],
    );
    return rows.map(toGrab);
  }

  async grabTimes(packet: string): Promise<{ count: number; first: number | null; last: number | null }> {
    const [r] = await this.sql.query('select count(*) as n, min(at) as first, max(at) as last from grabs where packet = $1', [packet]);
    return { count: num(r?.n), first: numOrNull(r?.first), last: numOrNull(r?.last) };
  }

  // ---------- push tokens ----------

  async registerPushToken(address: string, token: string) {
    await this.ensureUser(address);
    await this.sql.query(
      `insert into push_tokens (token, address) values ($1, $2)
       on conflict (token) do update set address = $2, updated_at = now()`,
      [token, address],
    );
  }

  async pushTokensFor(addresses: string[]): Promise<{ token: string; address: string }[]> {
    if (addresses.length === 0) return [];
    const rows = await this.sql.query('select token, address from push_tokens where address = any($1::text[])', [addresses]);
    return rows.map((r) => ({ token: str(r.token), address: str(r.address) }));
  }

  async allPushTokens(except: string[] = []): Promise<{ token: string; address: string }[]> {
    const rows = await this.sql.query(
      'select token, address from push_tokens where not (address = any($1::text[])) limit 5000',
      [except],
    );
    return rows.map((r) => ({ token: str(r.token), address: str(r.address) }));
  }

  async deletePushToken(token: string) {
    await this.sql.query('delete from push_tokens where token = $1', [token]);
  }

  // ---------- faucet ----------

  /** Reserves today's faucet claim for the wallet; false when it already claimed within 24 h. */
  async reserveFaucet(address: string): Promise<boolean> {
    const rows = await this.sql.query(
      `insert into faucet_claims (address) values ($1)
       on conflict (address) do update set claimed_at = now(), sol_signature = null, tskr_signature = null,
         genesis_mint = null, genesis_signature = null
       where faucet_claims.claimed_at < now() - interval '24 hours'
       returning address`,
      [address],
    );
    return rows.length > 0;
  }

  async releaseFaucet(address: string) {
    await this.sql.query('delete from faucet_claims where address = $1', [address]);
  }

  async recordFaucet(
    address: string,
    r: { sol: string | null; tskr: string | null; genesisMint: string | null; genesisSignature: string | null },
  ) {
    await this.sql.query(
      `update faucet_claims set sol_signature = $2, tskr_signature = $3, genesis_mint = $4, genesis_signature = $5
       where address = $1`,
      [address, r.sol, r.tskr, r.genesisMint, r.genesisSignature],
    );
  }

  // ---------- indexer cursor ----------

  async cursor(id = 'program'): Promise<{ signature: string; slot: number } | null> {
    const [r] = await this.sql.query('select signature, slot from indexer_cursor where id = $1', [id]);
    return r && r.signature ? { signature: str(r.signature), slot: num(r.slot) } : null;
  }

  async setCursor(signature: string, slot: number, id = 'program') {
    await this.sql.query(
      `insert into indexer_cursor (id, signature, slot) values ($1, $2, $3)
       on conflict (id) do update set signature = $2, slot = $3, updated_at = now()`,
      [id, signature, slot],
    );
  }
}
