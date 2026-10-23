-- ==========================================================
-- payouts.sql — Analytical Phase 2c: seller bank details and payouts
-- Run AFTER payments.sql
-- Run in: Supabase Dashboard > SQL Editor > New query
-- Safe to run more than once.
-- ==========================================================

-- ---------- 1. Who recorded each payout ----------
alter table public.payouts
  add column if not exists recorded_by uuid references public.profiles (id) on delete set null;

-- ---------- 2. Seller bank details ----------
create table if not exists public.payout_accounts (
  seller_id       uuid primary key references public.profiles (id) on delete cascade,
  bank_name       text not null,
  account_number  text not null,
  account_name    text not null,
  updated_at      timestamptz not null default now(),

  constraint payout_bank_len   check (char_length(bank_name) between 2 and 80),
  constraint payout_number_ok  check (account_number ~ '^[0-9]{10}$'),
  constraint payout_name_len   check (char_length(account_name) between 2 and 100)
);

alter table public.payout_accounts enable row level security;

revoke all on public.payout_accounts from anon, authenticated;
grant select, delete on public.payout_accounts to authenticated;
grant insert (seller_id, bank_name, account_number, account_name) on public.payout_accounts to authenticated;
grant update (bank_name, account_number, account_name) on public.payout_accounts to authenticated;

drop trigger if exists payout_accounts_set_updated_at on public.payout_accounts;
create trigger payout_accounts_set_updated_at
  before update on public.payout_accounts
  for each row execute function public.set_updated_at();

drop policy if exists "Sellers and staff read payout accounts" on public.payout_accounts;
create policy "Sellers and staff read payout accounts"
  on public.payout_accounts
  for select
  to authenticated
  using (seller_id = auth.uid() or public.is_staff());

drop policy if exists "Sellers add their own payout account" on public.payout_accounts;
create policy "Sellers add their own payout account"
  on public.payout_accounts
  for insert
  to authenticated
  with check (seller_id = auth.uid());

drop policy if exists "Sellers update their own payout account" on public.payout_accounts;
create policy "Sellers update their own payout account"
  on public.payout_accounts
  for update
  to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

drop policy if exists "Sellers delete their own payout account" on public.payout_accounts;
create policy "Sellers delete their own payout account"
  on public.payout_accounts
  for delete
  to authenticated
  using (seller_id = auth.uid());

-- ---------- 3. Staff view: what you owe each seller ----------
create or replace function public.admin_seller_balances()
returns table (
  seller_id       uuid,
  username        text,
  full_name       text,
  email           text,
  cur             text,
  sales_count     bigint,
  net             numeric,
  paid_out        numeric,
  balance         numeric,
  bank_name       text,
  account_number  text,
  account_name    text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;

  return query
  with s as (
    select p.seller_id as sid,
           p.currency  as c,
           count(*)    as n,
           coalesce(sum(p.seller_amount), 0) as t
    from public.dataset_purchases p
    where p.status = 'paid' and p.seller_id is not null
    group by p.seller_id, p.currency
  ),
  o as (
    select y.seller_id as sid,
           y.currency  as c,
           coalesce(sum(y.amount), 0) as t
    from public.payouts y
    group by y.seller_id, y.currency
  ),
  k as (
    select coalesce(s.sid, o.sid) as sid,
           coalesce(s.c, o.c)     as c,
           coalesce(s.n, 0)       as n,
           coalesce(s.t, 0)       as earned,
           coalesce(o.t, 0)       as paid
    from s full join o on s.sid = o.sid and s.c = o.c
  )
  select k.sid,
         pr.username,
         pr.full_name,
         u.email::text,
         k.c,
         k.n,
         k.earned,
         k.paid,
         k.earned - k.paid,
         a.bank_name,
         a.account_number,
         a.account_name
  from k
  join public.profiles pr on pr.id = k.sid
  left join auth.users u on u.id = k.sid
  left join public.payout_accounts a on a.seller_id = k.sid
  order by (k.earned - k.paid) desc, pr.username;
end;
$$;

-- ---------- 4. Staff action: record a payout ----------
-- Refuses amounts above the seller's real balance. The lock stops two
-- payouts for the same seller from being checked at the same moment.
create or replace function public.record_payout(
  p_seller_id  uuid,
  p_amount     numeric,
  p_currency   text,
  p_reference  text,
  p_note       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_earned numeric;
  v_paid   numeric;
  v_id     uuid;
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;

  if p_seller_id is null then
    raise exception 'Choose a seller';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount above zero';
  end if;

  if p_currency is null or upper(p_currency) <> 'NGN' then
    raise exception 'Only NGN payouts are supported';
  end if;

  perform pg_advisory_xact_lock(hashtext('payout:' || p_seller_id::text));

  select coalesce(sum(seller_amount), 0) into v_earned
  from public.dataset_purchases
  where seller_id = p_seller_id and status = 'paid' and currency = upper(p_currency);

  select coalesce(sum(amount), 0) into v_paid
  from public.payouts
  where seller_id = p_seller_id and currency = upper(p_currency);

  if round(p_amount, 2) > v_earned - v_paid then
    raise exception 'That is more than the seller''s balance';
  end if;

  insert into public.payouts (seller_id, amount, currency, reference, note, recorded_by)
  values (
    p_seller_id,
    round(p_amount, 2),
    upper(p_currency),
    nullif(trim(p_reference), ''),
    nullif(trim(p_note), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.admin_seller_balances() from public, anon;
revoke execute on function public.record_payout(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.admin_seller_balances() to authenticated;
grant execute on function public.record_payout(uuid, numeric, text, text, text) to authenticated;

notify pgrst, 'reload schema';