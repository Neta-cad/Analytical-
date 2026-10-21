-- ==========================================================
-- payments.sql — Analytical Phase 2b: paid datasets
-- Run AFTER datasets.sql
-- Run in: Supabase Dashboard > SQL Editor > New query
-- Safe to run more than once.
-- ==========================================================

-- ---------- 1. Allow paid prices (Naira only for now) ----------
alter table public.datasets drop constraint if exists datasets_free_only;
alter table public.datasets drop constraint if exists datasets_price_rules;

alter table public.datasets add constraint datasets_price_rules check (
  price_amount = 0
  or (currency = 'NGN' and price_amount between 100 and 5000000)
);

-- ---------- 2. Extend purchases with the money split ----------
alter table public.dataset_purchases
  add column if not exists seller_id         uuid references public.profiles (id) on delete set null,
  add column if not exists provider_tx_id    text,
  add column if not exists commission_rate   numeric(5,2),
  add column if not exists commission_amount numeric(12,2),
  add column if not exists seller_amount     numeric(12,2),
  add column if not exists paid_at           timestamptz;

alter table public.dataset_purchases drop constraint if exists purchases_status_ok;
alter table public.dataset_purchases add constraint purchases_status_ok
  check (status in ('pending', 'paid', 'failed', 'refunded', 'duplicate'));

alter table public.dataset_purchases drop constraint if exists purchases_amount_ok;
alter table public.dataset_purchases add constraint purchases_amount_ok check (amount > 0);

alter table public.dataset_purchases drop constraint if exists purchases_split_ok;
alter table public.dataset_purchases add constraint purchases_split_ok check (
  status <> 'paid'
  or (
    commission_amount is not null
    and seller_amount is not null
    and commission_amount + seller_amount = amount
  )
);

create index if not exists purchases_seller_idx on public.dataset_purchases (seller_id);

-- A buyer can own a dataset only once
create unique index if not exists purchases_one_paid_per_buyer
  on public.dataset_purchases (dataset_id, buyer_id)
  where status = 'paid';

-- ---------- 3. Payouts: money you send to sellers ----------
create table if not exists public.payouts (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles (id) on delete restrict,
  amount      numeric(12,2) not null check (amount > 0),
  currency    text not null default 'NGN',
  reference   text,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists payouts_seller_idx on public.payouts (seller_id);

alter table public.payouts enable row level security;

revoke all on public.payouts from anon, authenticated;
grant select on public.payouts to authenticated;

drop policy if exists "Sellers and staff see payouts" on public.payouts;
create policy "Sellers and staff see payouts"
  on public.payouts
  for select
  to authenticated
  using (seller_id = auth.uid() or public.is_staff());

-- ---------- 4. Has this member paid for this dataset? ----------
-- Runs with elevated rights so the access rules cannot loop into each other.
create or replace function public.has_purchased(p_dataset_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.dataset_purchases p
    where p.dataset_id = p_dataset_id
      and p.buyer_id = auth.uid()
      and p.status = 'paid'
  );
$$;

grant execute on function public.has_purchased(uuid) to anon, authenticated;

-- Buyers can still see a dataset they paid for, even if it was unpublished
drop policy if exists "Published datasets are public" on public.datasets;
create policy "Published datasets are public"
  on public.datasets
  for select
  to anon, authenticated
  using (
    status = 'published'
    or owner_id = auth.uid()
    or public.is_staff()
    or (status <> 'removed' and public.has_purchased(id))
  );

-- ---------- 5. Who may download (updated for paid datasets) ----------
create or replace function public.can_download_dataset(p_dataset_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  d   public.datasets%rowtype;
  uid uuid := auth.uid();
begin
  if uid is null then
    return false;
  end if;

  select * into d from public.datasets where id = p_dataset_id;
  if not found then
    return false;
  end if;

  if d.owner_id = uid or public.is_staff() then
    return true;
  end if;

  if d.status = 'removed' then
    return false;
  end if;

  if d.price_amount = 0 then
    return d.status = 'published';
  end if;

  return exists (
    select 1 from public.dataset_purchases p
    where p.dataset_id = d.id and p.buyer_id = uid and p.status = 'paid'
  );
end;
$$;

-- ---------- 6. Finish a payment (called only by the server) ----------
-- Runs as one locked step, so a payment can never be counted twice.
create or replace function public.complete_purchase(
  p_reference        text,
  p_amount           numeric,
  p_currency         text,
  p_tx_id            text,
  p_commission_rate  numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pur        public.dataset_purchases%rowtype;
  commission numeric(12,2);
begin
  select * into pur
  from public.dataset_purchases
  where provider_ref = p_reference
  for update;

  if not found then
    return 'not_found';
  end if;

  if pur.status = 'paid' then
    return 'already_paid';
  end if;

  if pur.status in ('refunded', 'duplicate') then
    return pur.status;
  end if;

  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100 then
    return 'bad_rate';
  end if;

  -- The amount and currency Paystack confirmed must match what we expected
  if pur.amount <> p_amount or upper(pur.currency) <> upper(p_currency) then
    return 'mismatch';
  end if;

  -- The buyer already owns this dataset: flag this payment for a refund
  if pur.buyer_id is not null and exists (
    select 1 from public.dataset_purchases o
    where o.dataset_id = pur.dataset_id
      and o.buyer_id = pur.buyer_id
      and o.status = 'paid'
      and o.id <> pur.id
  ) then
    update public.dataset_purchases
      set status = 'duplicate', provider_tx_id = p_tx_id
      where id = pur.id;
    return 'duplicate';
  end if;

  commission := round(pur.amount * p_commission_rate / 100, 2);

  update public.dataset_purchases
    set status            = 'paid',
        provider_tx_id    = p_tx_id,
        commission_rate   = p_commission_rate,
        commission_amount = commission,
        seller_amount     = pur.amount - commission,
        paid_at           = now()
    where id = pur.id;

  return 'paid';
end;
$$;

-- Mark a payment attempt as failed (called only by the server)
create or replace function public.fail_purchase(p_reference text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.dataset_purchases
    set status = 'failed'
    where provider_ref = p_reference and status = 'pending';
$$;

revoke execute on function public.complete_purchase(text, numeric, text, text, numeric) from public, anon, authenticated;
revoke execute on function public.fail_purchase(text) from public, anon, authenticated;
grant execute on function public.complete_purchase(text, numeric, text, text, numeric) to service_role;
grant execute on function public.fail_purchase(text) to service_role;

-- ---------- 7. A seller's earnings, from real paid sales ----------
create or replace function public.my_earnings()
returns table (
  cur          text,
  sales_count  bigint,
  gross        numeric,
  commission   numeric,
  net          numeric,
  paid_out     numeric,
  balance      numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with s as (
    select currency as c,
           count(*) as n,
           coalesce(sum(amount), 0) as g,
           coalesce(sum(commission_amount), 0) as k,
           coalesce(sum(seller_amount), 0) as t
    from public.dataset_purchases
    where seller_id = auth.uid() and status = 'paid'
    group by currency
  ),
  p as (
    select currency as c, coalesce(sum(amount), 0) as o
    from public.payouts
    where seller_id = auth.uid()
    group by currency
  )
  select coalesce(s.c, p.c),
         coalesce(s.n, 0),
         coalesce(s.g, 0),
         coalesce(s.k, 0),
         coalesce(s.t, 0),
         coalesce(p.o, 0),
         coalesce(s.t, 0) - coalesce(p.o, 0)
  from s full join p on s.c = p.c;
$$;

revoke execute on function public.my_earnings() from public, anon;
grant execute on function public.my_earnings() to authenticated;

-- Make the new columns and functions available straight away
notify pgrst, 'reload schema';