create table if not exists public.qernix_wallet_state (
  id integer primary key check (id = 1),
  btc numeric(30,8) not null default 5,
  eth numeric(30,8) not null default 5,
  panic_active boolean not null default false,
  panic_event jsonb,
  updated_at timestamptz not null default now()
);

insert into public.qernix_wallet_state (id) values (1)
on conflict (id) do nothing;

create table if not exists public.qernix_transfers (
  id text primary key,
  coin text not null check (coin in ('btc', 'eth')),
  amount numeric(30,8) not null check (amount > 0),
  destination text not null,
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.qernix_tickets (
  id uuid primary key default gen_random_uuid(),
  sender text not null,
  message text not null check (char_length(message) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.qernix_wallet_state enable row level security;
alter table public.qernix_transfers enable row level security;
alter table public.qernix_tickets enable row level security;

