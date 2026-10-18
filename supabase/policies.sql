-- ==========================================================
-- policies.sql — Analytical: row-level security + avatar storage
-- Run AFTER schema.sql
-- Run in: Supabase Dashboard > SQL Editor > New query
-- Safe to run more than once.
-- ==========================================================

-- ---------- Profiles: who can do what ----------

-- Make sure RLS is on (schema.sql already did this)
alter table public.profiles enable row level security;

-- Anyone can view profiles (public community). Emails are NOT stored here.
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

-- Logged-in users can edit ONLY their own profile.
-- Role, reputation and verified status are locked by a trigger in schema.sql.
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert policy: profiles are created only by the signup trigger.
-- No delete policy: profiles are removed only when the account is deleted.


-- ---------- Avatar storage bucket ----------
-- Public read, 2 MB limit, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can view avatars
drop policy if exists "Avatars are publicly viewable" on storage.objects;
create policy "Avatars are publicly viewable"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- Users can upload only into their own folder: avatars/<their-user-id>/...
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can replace their own avatar
drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete their own avatar
drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );