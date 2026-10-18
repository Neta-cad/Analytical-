-- ==========================================================
-- schema.sql — Analytical: profiles table + signup trigger
-- Run in: Supabase Dashboard > SQL Editor > New query
-- Safe to run more than once.
-- ==========================================================

-- ---------- Profiles table ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique,
  full_name     text,
  headline      text,
  bio           text,
  avatar_url    text,
  country       text,
  website_url   text,
  github_url    text,
  linkedin_url  text,
  skills        text[] not null default '{}',
  user_role     text not null default 'member',
  reputation    integer not null default 0,
  is_verified   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint profiles_headline_len    check (headline is null or char_length(headline) <= 100),
  constraint profiles_bio_len         check (bio is null or char_length(bio) <= 280),
  constraint profiles_country_format  check (country is null or country ~ '^[A-Z]{2}$'),
  constraint profiles_role_valid      check (user_role in ('member', 'moderator', 'admin')),
  constraint profiles_skills_max      check (cardinality(skills) <= 30)
);

create index if not exists profiles_country_idx on public.profiles (country);
create index if not exists profiles_created_idx on public.profiles (created_at desc);

-- Lock the table now. Nobody can read or write until policies.sql is run.
alter table public.profiles enable row level security;

-- ---------- Keep updated_at fresh ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- Protect sensitive columns ----------
-- Logged-in users can edit their own profile, but they must never be able
-- to make themselves admin, verified, or raise their own reputation.
-- Changes made here in the SQL Editor are still allowed.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.id is distinct from old.id then
      raise exception 'Profile id cannot be changed';
    end if;
    if new.user_role is distinct from old.user_role then
      raise exception 'Role cannot be changed';
    end if;
    if new.reputation is distinct from old.reputation then
      raise exception 'Reputation cannot be changed';
    end if;
    if new.is_verified is distinct from old.is_verified then
      raise exception 'Verified status cannot be changed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------- Auto-create a profile on signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name  text;
  final_name text;
  attempts   integer := 0;
  meta_country text;
begin
  -- Start from the chosen username, or the part of the email before the @
  base_name := lower(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  ));

  base_name := regexp_replace(base_name, '[^a-z0-9_]', '', 'g');

  if char_length(base_name) < 3 then
    base_name := 'user' || base_name;
  end if;

  base_name  := left(base_name, 24);
  final_name := base_name;

  -- If taken, add random digits until it is unique
  while exists (select 1 from public.profiles where username = final_name) loop
    attempts := attempts + 1;

    if attempts > 20 then
      final_name := 'user' || replace(left(new.id::text, 8), '-', '');
      exit;
    end if;

    final_name := left(base_name, 19) || (floor(random() * 90000) + 10000)::int::text;
  end loop;

  meta_country := upper(new.raw_user_meta_data ->> 'country');
  if meta_country is null or meta_country !~ '^[A-Z]{2}$' then
    meta_country := null;
  end if;

  insert into public.profiles (id, username, full_name, country)
  values (
    new.id,
    final_name,
    nullif(left(new.raw_user_meta_data ->> 'full_name', 80), ''),
    meta_country
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();