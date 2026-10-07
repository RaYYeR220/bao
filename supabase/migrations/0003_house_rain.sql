-- House rain: when fewer than a couple of public packets are live, the crank drops one from the
-- faucet key, so someone who installs the app weeks from now still finds something to grab.
-- One row ('house'). The crank claims `claimed_at` atomically before it sends, so concurrent
-- ticks and retries never drop twice in one interval. Times are unix seconds, like `packets`.
create table house_rain (
  id text primary key,
  claimed_at bigint,
  dropped_at bigint,
  packet text,
  signature text,
  drops integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Service role only, like every other table the API owns.
alter table house_rain enable row level security;

-- A display name the server gives its own wallets ('Bao' for the house sender). Lists show it
-- where a `.skr` name would go; identity reads (`/api/users/:address`) keep the real `.skr` only.
alter table users add column label text;
