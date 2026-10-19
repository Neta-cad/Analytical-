-- ==========================================================
-- datasets.sql — Analytical Phase 2: datasets, downloads,
-- purchases (ready for later), private file storage
-- Run AFTER schema.sql and policies.sql
-- Run in: Supabase Dashboard > SQL Editor > New query
-- Safe to run more than once.
-- ==========================================================

-- ---------- Helper: is the current user staff? ----------
create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and user_role in ('admin', 'moderator')
  );
$$;

-- ---------- Datasets ----------
create table if not exists public.datasets (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid()
                    references public.profiles (id) on delete cascade,

  title           text not null,
  description     text not null,
  category        text not null default 'other',
  tags            text[] not null default '{}',
  license         text not null default 'cc-by',

  price_amount    numeric(12,2) not null default 0,
  currency        text not null default 'NGN',
  is_free         boolean generated always as (price_amount = 0) stored,

  file_path       text not null,
  file_name       text not null,
  file_size       bigint not null,
  file_type       text not null,

  columns         text[] not null default '{}',
  preview         jsonb not null default '[]'::jsonb,
  row_count       integer,

  status          text not null default 'published',
  download_count  integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint datasets_title_len     check (char_length(title) between 3 and 120),
  constraint datasets_desc_len      check (char_length(description) between 10 and 5000),
  constraint datasets_category_ok   check (category in (
    'business', 'finance', 'health', 'education', 'technology', 'science',
    'agriculture', 'environment', 'transport', 'government', 'social',
    'sports', 'entertainment', 'other')),
  constraint datasets_tags_max      check (cardinality(tags) <= 10),
  constraint datasets_license_ok    check (license in (
    'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'odbl', 'custom')),
  constraint datasets_price_ok      check (price_amount >= 0),
  constraint datasets_currency_ok   check (currency ~ '^[A-Z]{3}$'),
  constraint datasets_file_type_ok  check (file_type in ('csv', 'xlsx', 'xls', 'json', 'zip')),
  constraint datasets_file_size_ok  check (file_size > 0 and file_size <= 52428800),
  constraint datasets_name_len      check (char_length(file_name) between 1 and 200),
  constraint datasets_columns_max   check (cardinality(columns) <= 200),
  constraint datasets_preview_ok    check (jsonb_typeof(preview) = 'array' and jsonb_array_length(preview) <= 10),
  constraint datasets_rows_ok       check (row_count is null or row_count >= 0),
  constraint datasets_status_ok     check (status in ('draft', 'published', 'removed')),

  -- Free only until payments go live. Phase 2b drops this one rule.
  constraint datasets_free_only     check (price_amount = 0)
);

create unique index if not exists datasets_file_path_key on public.datasets (file_path);
create index if not exists datasets_status_created_idx on public.datasets (status, created_at desc);
create index if not exists datasets_category_idx on public.datasets (category);
create index if not exists datasets_owner_idx on public.datasets (owner_id);
create index if not exists datasets_tags_idx on public.datasets using gin (tags);

alter table public.datasets enable row level security;

drop trigger if exists datasets_set_updated_at on public.datasets;
create trigger datasets_set_updated_at
  before update on public.datasets
  for each row execute function public.set_updated_at();

-- Only staff can remove a dataset, and only staff can bring one back
create or replace function public.guard_dataset_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if (new.status = 'removed' or old.status = 'removed') and not public.is_staff() then
      raise exception 'Only staff can change the removed status';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists datasets_guard_status on public.datasets;
create trigger datasets_guard_status
  before update on public.datasets
  for each row execute function public.guard_dataset_status();

-- Members may only write the columns below. Everything else
-- (owner, download count, dates) is controlled by the system.
revoke insert, update on public.datasets from anon, authenticated;

grant select on public.datasets to anon, authenticated;
grant delete on public.datasets to authenticated;

grant insert (
  owner_id, title, description, category, tags, license,
  price_amount, currency, file_path, file_name, file_size, file_type,
  columns, preview, row_count, status
) on public.datasets to authenticated;

grant update (
  title, description, category, tags, license,
  price_amount, currency, file_path, file_name, file_size, file_type,
  columns, preview, row_count, status
) on public.datasets to authenticated;

-- ---------- Datasets: who can do what ----------
drop policy if exists "Published datasets are public" on public.datasets;
create policy "Published datasets are public"
  on public.datasets
  for select
  to anon, authenticated
  using (status = 'published' or owner_id = auth.uid() or public.is_staff());

drop policy if exists "Members add their own datasets" on public.datasets;
create policy "Members add their own datasets"
  on public.datasets
  for insert
  to authenticated
  with check (owner_id = auth.uid() and status in ('draft', 'published'));

drop policy if exists "Owners and staff update datasets" on public.datasets;
create policy "Owners and staff update datasets"
  on public.datasets
  for update
  to authenticated
  using (owner_id = auth.uid() or public.is_staff())
  with check (owner_id = auth.uid() or public.is_staff());

drop policy if exists "Owners and staff delete datasets" on public.datasets;
create policy "Owners and staff delete datasets"
  on public.datasets
  for delete
  to authenticated
  using (owner_id = auth.uid() or public.is_staff());

-- ---------- Purchases (filled by the payment system in Phase 2b) ----------
create table if not exists public.dataset_purchases (
  id            uuid primary key default gen_random_uuid(),
  dataset_id    uuid not null references public.datasets (id) on delete restrict,
  buyer_id      uuid references public.profiles (id) on delete set null,
  amount        numeric(12,2) not null,
  currency      text not null,
  provider      text not null,
  provider_ref  text not null unique,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),

  constraint purchases_status_ok check (status in ('pending', 'paid', 'failed', 'refunded')),
  constraint purchases_amount_ok check (amount >= 0)
);

create index if not exists purchases_dataset_idx on public.dataset_purchases (dataset_id);
create index if not exists purchases_buyer_idx on public.dataset_purchases (buyer_id);

alter table public.dataset_purchases enable row level security;

revoke all on public.dataset_purchases from anon, authenticated;
grant select on public.dataset_purchases to authenticated;

drop policy if exists "Buyers, sellers and staff see purchases" on public.dataset_purchases;
create policy "Buyers, sellers and staff see purchases"
  on public.dataset_purchases
  for select
  to authenticated
  using (
    buyer_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.datasets d
      where d.id = dataset_purchases.dataset_id and d.owner_id = auth.uid()
    )
  );

-- ---------- Downloads ----------
create table if not exists public.dataset_downloads (
  id          uuid primary key default gen_random_uuid(),
  dataset_id  uuid not null references public.datasets (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (dataset_id, user_id)
);

create index if not exists downloads_user_idx on public.dataset_downloads (user_id);

alter table public.dataset_downloads enable row level security;

revoke all on public.dataset_downloads from anon, authenticated;
grant select on public.dataset_downloads to authenticated;

drop policy if exists "Members see their own downloads" on public.dataset_downloads;
create policy "Members see their own downloads"
  on public.dataset_downloads
  for select
  to authenticated
  using (user_id = auth.uid());

-- ---------- Can this person download this dataset? ----------
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

  if d.status <> 'published' then
    return false;
  end if;

  if d.price_amount = 0 then
    return true;
  end if;

  return exists (
    select 1 from public.dataset_purchases p
    where p.dataset_id = d.id and p.buyer_id = uid and p.status = 'paid'
  );
end;
$$;

revoke execute on function public.can_download_dataset(uuid) from public, anon;
grant execute on function public.can_download_dataset(uuid) to authenticated;

-- ---------- Count a download (once per member per dataset) ----------
create or replace function public.record_dataset_download(p_dataset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Log in to download';
  end if;

  if not public.can_download_dataset(p_dataset_id) then
    raise exception 'You do not have access to this dataset';
  end if;

  insert into public.dataset_downloads (dataset_id, user_id)
  values (p_dataset_id, auth.uid())
  on conflict (dataset_id, user_id) do nothing;

  if found then
    update public.datasets
      set download_count = download_count + 1
      where id = p_dataset_id;
  end if;
end;
$$;

revoke execute on function public.record_dataset_download(uuid) from public, anon;
grant execute on function public.record_dataset_download(uuid) to authenticated;

-- ---------- Private file storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'datasets',
  'datasets',
  false,
  52428800,
  array[
    'text/csv',
    'application/json',
    'application/zip',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Members can upload only into their own folder: datasets/<their-user-id>/...
drop policy if exists "Members upload their own dataset files" on storage.objects;
create policy "Members upload their own dataset files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members update their own dataset files" on storage.objects;
create policy "Members update their own dataset files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members delete their own dataset files" on storage.objects;
create policy "Members delete their own dataset files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Members can always read their own files
drop policy if exists "Members read their own dataset files" on storage.objects;
create policy "Members read their own dataset files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Everyone else can read a file only if the rules above allow the download
drop policy if exists "Members read files they may download" on storage.objects;
create policy "Members read files they may download"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'datasets'
    and exists (
      select 1 from public.datasets d
      where d.file_path = name
        and public.can_download_dataset(d.id)
    )
  );