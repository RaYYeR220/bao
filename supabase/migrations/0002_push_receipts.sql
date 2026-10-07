-- One push per event. The Helius webhook, the cron poller and webhook retries all replay the same
-- transaction; "Luck King" and "Your share arrived" went out once per replay. A receipt is claimed
-- before sending: 'luck_king:<packet>' (one crown per packet) and 'paid_out:<packet>:<claimer>'.
create table push_receipts (
  key text primary key,
  sent_at timestamptz not null default now()
);

-- Service role only, like every other table the API owns.
alter table push_receipts enable row level security;
