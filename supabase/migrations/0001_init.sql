-- Bao: off-chain mirror of the devnet program plus the social layer (circles, push, faucet).
-- Money never moves through this database; every row here can be rebuilt from chain + app input.

-- Any address the API has seen. Caches identity reads from mainnet (.skr, Seeker Genesis).
create table users (
  address text primary key,
  skr_name text,
  skr_checked_at timestamptz,
  seeker_mainnet boolean not null default false,
  seeker_checked_at timestamptz,
  devnet_genesis_mint text,
  genesis_checked_at timestamptz,
  signed_in_at timestamptz,
  created_at timestamptz not null default now()
);

-- Single-use Sign-In With Solana challenges.
create table auth_nonces (
  nonce text primary key,
  address text not null,
  input jsonb not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_nonces_expires_at on auth_nonces (expires_at);

create table circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 48),
  emoji text check (emoji is null or char_length(emoji) <= 16),
  invite_code text not null unique,
  owner text not null references users (address),
  created_at timestamptz not null default now()
);

create table circle_members (
  circle_id uuid not null references circles (id) on delete cascade,
  address text not null references users (address),
  joined_at timestamptz not null default now(),
  primary key (circle_id, address)
);
create index circle_members_address on circle_members (address);

-- Member lists frozen into a packet's Merkle root; proofs are rebuilt from `members` in order.
create table circle_snapshots (
  circle_id uuid not null references circles (id) on delete cascade,
  root text not null,
  members text[] not null,
  created_at timestamptz not null default now(),
  primary key (circle_id, root)
);
create index circle_snapshots_root on circle_snapshots (root);

-- On-chain packets (mirrored by the indexer) plus what the sender's app registered.
create table packets (
  address text primary key,
  sender text not null,
  packet_id numeric(20, 0),
  mint text not null,
  token_program text,
  decimals smallint,
  total_amount numeric(20, 0) not null,
  remaining_amount numeric(20, 0) not null,
  total_shares smallint not null,
  reserved smallint not null default 0,
  resolved smallint not null default 0,
  mode text not null check (mode in ('lucky', 'equal')),
  audience text not null check (audience in ('open', 'circle', 'code')),
  merkle_root text,
  seeker_only boolean not null default true,
  created_at bigint not null,
  starts_at bigint not null,
  expires_at bigint not null,
  message_hash text,
  parent text,
  chain_root text not null,
  chain_depth integer not null default 0,
  luck_king text,
  luck_king_amount numeric(20, 0),
  crowned boolean not null default false,
  status text not null default 'live' check (status in ('scheduled', 'live', 'emptied', 'expired', 'closed')),
  message text,
  skin text,
  circle_id uuid references circles (id) on delete set null,
  snapshot_root text,
  code_hint text,
  registered_at timestamptz,
  create_signature text,
  close_signature text,
  refunded numeric(20, 0),
  dropped_push_at timestamptz,
  rain_push_at timestamptz,
  emptied_push_at timestamptz,
  indexed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index packets_sender on packets (sender);
create index packets_circle on packets (circle_id);
create index packets_open_live on packets (audience, status, starts_at);
create index packets_chain_root on packets (chain_root);
create index packets_luck_king on packets (luck_king);

-- One row per claim record (packet, device). Lucky: pending -> won -> paid; equal: paid at once.
create table grabs (
  packet text not null,
  device_key text not null,
  claimer text not null,
  claim_index smallint not null,
  amount numeric(20, 0),
  status text not null check (status in ('pending', 'won', 'paid', 'forfeited')),
  grab_signature text,
  callback_signature text,
  payout_signature text,
  randomness text,
  slot bigint not null default 0,
  at bigint not null,
  updated_at timestamptz not null default now(),
  primary key (packet, device_key)
);
create index grabs_claimer on grabs (claimer);

create table push_tokens (
  token text primary key,
  address text not null,
  platform text not null default 'android',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_tokens_address on push_tokens (address);

create table faucet_claims (
  address text primary key,
  claimed_at timestamptz not null default now(),
  sol_signature text,
  tskr_signature text,
  genesis_mint text,
  genesis_signature text
);

create table indexer_cursor (
  id text primary key,
  signature text,
  slot bigint,
  updated_at timestamptz not null default now()
);

-- Rains: public packets scheduled for a time.
create view rains with (security_invoker = true) as
  select * from packets where audience = 'open' and starts_at > created_at;

alter table users enable row level security;
alter table auth_nonces enable row level security;
alter table circles enable row level security;
alter table circle_members enable row level security;
alter table circle_snapshots enable row level security;
alter table packets enable row level security;
alter table grabs enable row level security;
alter table push_tokens enable row level security;
alter table faucet_claims enable row level security;
alter table indexer_cursor enable row level security;

-- The app reads packets and grabs over Realtime with the anon key; everything else goes
-- through the API with the service role. Guarded so the same file runs on plain Postgres.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    create policy packets_public_read on packets for select to anon, authenticated using (true);
    create policy grabs_public_read on grabs for select to anon, authenticated using (true);
    revoke insert, update, delete, truncate on packets, grabs from anon, authenticated;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table packets, grabs;
  end if;
end
$$;
