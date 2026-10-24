-- ==========================================================
-- admin.sql — Analytical Phase 3: admin tools, support, reports
-- Run AFTER payouts.sql
-- Run in: Supabase Dashboard > SQL Editor > New query
-- Safe to run more than once.
-- ==========================================================

-- ---------- 0. Make sure the payout column exists ----------
alter table public.payouts
  add column if not exists recorded_by uuid references public.profiles (id) on delete set null;

-- ---------- 1. Suspension flag ----------
alter table public.profiles
  add column if not exists is_suspended boolean not null default false;

-- ---------- 2. Helper checks ----------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and user_role = 'admin'
  );
$$;

create or replace function public.is_suspended()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_suspended from public.profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_suspended() to anon, authenticated;

-- ---------- 3. Protect sensitive profile columns ----------
-- Members can never change these on their own account. Staff may verify
-- members. Only admins may change roles or suspend.
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
    if new.user_role is distinct from old.user_role and not public.is_admin() then
      raise exception 'Only an admin can change roles';
    end if;
    if new.is_suspended is distinct from old.is_suspended and not public.is_admin() then
      raise exception 'Only an admin can suspend members';
    end if;
    if new.reputation is distinct from old.reputation and not public.is_staff() then
      raise exception 'Reputation cannot be changed';
    end if;
    if new.is_verified is distinct from old.is_verified and not public.is_staff() then
      raise exception 'Verified status cannot be changed';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- 4. Audit log ----------
create table if not exists public.admin_audit (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

alter table public.admin_audit enable row level security;

revoke all on public.admin_audit from anon, authenticated;
grant select on public.admin_audit to authenticated;

drop policy if exists "Admins read the audit log" on public.admin_audit;
create policy "Admins read the audit log"
  on public.admin_audit
  for select
  to authenticated
  using (public.is_admin());

-- Only other database functions can write to the log
create or replace function public.log_admin_action(
  p_action       text,
  p_target_type  text,
  p_target_id    text,
  p_details      jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_audit (actor_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

revoke execute on function public.log_admin_action(text, text, text, jsonb) from public, anon, authenticated;

-- Every payout is logged automatically
create or replace function public.audit_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit (actor_id, action, target_type, target_id, details)
  values (
    new.recorded_by,
    'payout_recorded',
    'seller',
    new.seller_id::text,
    jsonb_build_object('amount', new.amount, 'currency', new.currency, 'reference', new.reference)
  );
  return new;
end;
$$;

drop trigger if exists payouts_audit on public.payouts;
create trigger payouts_audit
  after insert on public.payouts
  for each row execute function public.audit_payout();

-- ---------- 5. Support tickets ----------
create table if not exists public.support_tickets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  subject          text not null,
  category         text not null default 'other',
  status           text not null default 'open',
  dataset_id       uuid references public.datasets (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),

  constraint tickets_subject_len check (char_length(subject) between 3 and 150),
  constraint tickets_category_ok check (category in ('account', 'payments', 'dataset', 'abuse', 'other')),
  constraint tickets_status_ok   check (status in ('open', 'answered', 'closed'))
);

create index if not exists tickets_user_idx on public.support_tickets (user_id, last_message_at desc);
create index if not exists tickets_status_idx on public.support_tickets (status, last_message_at desc);

create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  sender_id   uuid references public.profiles (id) on delete set null,
  from_staff  boolean not null default false,
  body        text not null,
  created_at  timestamptz not null default now(),

  constraint ticket_body_len check (char_length(body) between 1 and 5000)
);

create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.ticket_messages enable row level security;

revoke all on public.support_tickets from anon, authenticated;
revoke all on public.ticket_messages from anon, authenticated;
grant select on public.support_tickets to authenticated;
grant select on public.ticket_messages to authenticated;

drop policy if exists "Members and staff read tickets" on public.support_tickets;
create policy "Members and staff read tickets"
  on public.support_tickets
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

drop policy if exists "Members and staff read ticket messages" on public.ticket_messages;
create policy "Members and staff read ticket messages"
  on public.ticket_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = ticket_messages.ticket_id
        and (t.user_id = auth.uid() or public.is_staff())
    )
  );

-- Open a new support request
create or replace function public.create_ticket(
  p_subject     text,
  p_category    text,
  p_body        text,
  p_dataset_id  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  subj text := trim(coalesce(p_subject, ''));
  msg  text := trim(coalesce(p_body, ''));
  ds   uuid := null;
  tid  uuid;
begin
  if uid is null then
    raise exception 'Log in to contact support';
  end if;

  if char_length(subj) < 3 or char_length(subj) > 150 then
    raise exception 'The subject must be 3 to 150 characters';
  end if;

  if char_length(msg) < 10 or char_length(msg) > 5000 then
    raise exception 'The message must be 10 to 5000 characters';
  end if;

  if coalesce(p_category, '') not in ('account', 'payments', 'dataset', 'abuse', 'other') then
    raise exception 'Choose a category';
  end if;

  if (select count(*) from public.support_tickets
      where user_id = uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have reached the daily limit of 5 support requests. Please try again tomorrow';
  end if;

  if (select count(*) from public.support_tickets
      where user_id = uid and status <> 'closed') >= 10 then
    raise exception 'You have 10 open support requests. Please wait for replies or close some first';
  end if;

  if p_dataset_id is not null and exists (select 1 from public.datasets where id = p_dataset_id) then
    ds := p_dataset_id;
  end if;

  insert into public.support_tickets (user_id, subject, category, dataset_id)
  values (uid, subj, p_category, ds)
  returning id into tid;

  insert into public.ticket_messages (ticket_id, sender_id, from_staff, body)
  values (tid, uid, false, msg);

  return tid;
end;
$$;

-- Reply to a request (members on their own, staff on any)
create or replace function public.reply_ticket(
  p_ticket_id  uuid,
  p_body       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  msg        text := trim(coalesce(p_body, ''));
  t          public.support_tickets%rowtype;
  staff      boolean := public.is_staff();
  as_staff   boolean;
begin
  if uid is null then
    raise exception 'Log in to reply';
  end if;

  if char_length(msg) < 1 or char_length(msg) > 5000 then
    raise exception 'The message must be 1 to 5000 characters';
  end if;

  select * into t from public.support_tickets where id = p_ticket_id for update;

  if not found or (not staff and t.user_id <> uid) then
    raise exception 'Ticket not found';
  end if;

  if t.status = 'closed' and not staff then
    raise exception 'This request is closed. Open a new one if you still need help';
  end if;

  if (select count(*) from public.ticket_messages
      where sender_id = uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a little';
  end if;

  -- Staff replying on their own ticket act as a normal member
  as_staff := staff and t.user_id <> uid;

  insert into public.ticket_messages (ticket_id, sender_id, from_staff, body)
  values (t.id, uid, as_staff, msg);

  update public.support_tickets
    set status = case when as_staff then 'answered' else 'open' end,
        last_message_at = now(),
        updated_at = now()
    where id = t.id;

  if as_staff then
    perform public.log_admin_action('ticket_replied', 'ticket', t.id::text, '{}'::jsonb);
  end if;
end;
$$;

-- Change a request's status (staff: any status, members: close their own)
create or replace function public.set_ticket_status(
  p_ticket_id  uuid,
  p_status     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  t      public.support_tickets%rowtype;
  staff  boolean := public.is_staff();
begin
  if uid is null then
    raise exception 'Log in to continue';
  end if;

  if coalesce(p_status, '') not in ('open', 'answered', 'closed') then
    raise exception 'Choose a valid status';
  end if;

  select * into t from public.support_tickets where id = p_ticket_id for update;

  if not found or (not staff and t.user_id <> uid) then
    raise exception 'Ticket not found';
  end if;

  if not staff and p_status <> 'closed' then
    raise exception 'You can only close your own request';
  end if;

  update public.support_tickets
    set status = p_status, updated_at = now()
    where id = t.id;

  if staff then
    perform public.log_admin_action(
      'ticket_status', 'ticket', t.id::text, jsonb_build_object('status', p_status)
    );
  end if;
end;
$$;

-- ---------- 6. Reports ----------
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  target_type      text not null,
  target_id        uuid not null,
  reason           text not null,
  details          text,
  status           text not null default 'open',
  handled_by       uuid references public.profiles (id) on delete set null,
  resolution_note  text,
  created_at       timestamptz not null default now(),
  handled_at       timestamptz,

  constraint reports_target_ok check (target_type in ('dataset', 'profile')),
  constraint reports_reason_ok check (reason in ('spam', 'copyright', 'inappropriate', 'scam', 'misleading', 'other')),
  constraint reports_details_len check (details is null or char_length(details) <= 1000),
  constraint reports_status_ok check (status in ('open', 'reviewing', 'resolved', 'dismissed'))
);

create unique index if not exists reports_one_open
  on public.reports (reporter_id, target_type, target_id)
  where status in ('open', 'reviewing');

create index if not exists reports_status_idx on public.reports (status, created_at desc);

alter table public.reports enable row level security;

revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

drop policy if exists "Reporters and staff read reports" on public.reports;
create policy "Reporters and staff read reports"
  on public.reports
  for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

create or replace function public.create_report(
  p_target_type  text,
  p_target_id    uuid,
  p_reason       text,
  p_details      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  det  text := nullif(trim(coalesce(p_details, '')), '');
  rid  uuid;
begin
  if uid is null then
    raise exception 'Log in to report';
  end if;

  if coalesce(p_target_type, '') not in ('dataset', 'profile') then
    raise exception 'You can report datasets and profiles';
  end if;

  if coalesce(p_reason, '') not in ('spam', 'copyright', 'inappropriate', 'scam', 'misleading', 'other') then
    raise exception 'Choose a reason';
  end if;

  if det is not null and char_length(det) > 1000 then
    raise exception 'Details must be 1000 characters or fewer';
  end if;

  if p_target_type = 'dataset' then
    if not exists (select 1 from public.datasets where id = p_target_id) then
      raise exception 'That dataset could not be found';
    end if;
    if exists (select 1 from public.datasets where id = p_target_id and owner_id = uid) then
      raise exception 'You cannot report your own dataset';
    end if;
  else
    if not exists (select 1 from public.profiles where id = p_target_id) then
      raise exception 'That profile could not be found';
    end if;
    if p_target_id = uid then
      raise exception 'You cannot report yourself';
    end if;
  end if;

  if (select count(*) from public.reports
      where reporter_id = uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You have reached the daily limit of reports. Please try again tomorrow';
  end if;

  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, details)
    values (uid, p_target_type, p_target_id, p_reason, det)
    returning id into rid;
  exception when unique_violation then
    raise exception 'You have already reported this. We are reviewing it';
  end;

  return rid;
end;
$$;

create or replace function public.resolve_report(
  p_report_id  uuid,
  p_status     text,
  p_note       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;

  if coalesce(p_status, '') not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'Choose a valid status';
  end if;

  if n is not null and char_length(n) > 500 then
    raise exception 'The note must be 500 characters or fewer';
  end if;

  update public.reports
    set status = p_status,
        handled_by = auth.uid(),
        resolution_note = n,
        handled_at = case when p_status = 'reviewing' then null else now() end
    where id = p_report_id;

  if not found then
    raise exception 'Report not found';
  end if;

  perform public.log_admin_action(
    'report_' || p_status, 'report', p_report_id::text, jsonb_build_object('note', n)
  );
end;
$$;

-- ---------- 7. Admin actions on datasets ----------
create or replace function public.admin_set_dataset_status(
  p_dataset_id  uuid,
  p_status      text,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;

  if coalesce(p_status, '') not in ('published', 'draft', 'removed') then
    raise exception 'Choose a valid status';
  end if;

  update public.datasets set status = p_status where id = p_dataset_id;

  if not found then
    raise exception 'Dataset not found';
  end if;

  perform public.log_admin_action(
    'dataset_' || p_status, 'dataset', p_dataset_id::text,
    jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''))
  );
end;
$$;

-- Delete a dataset for good. Refused when any sale exists. Returns the file
-- path so the admin site can remove the file from storage.
create or replace function public.admin_delete_dataset(p_dataset_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  path   text;
  title  text;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;

  select file_path, d.title into path, title from public.datasets d where d.id = p_dataset_id;

  if not found then
    raise exception 'Dataset not found';
  end if;

  if exists (select 1 from public.dataset_purchases where dataset_id = p_dataset_id) then
    raise exception 'This dataset has sales on record, so it cannot be deleted. Take it down instead';
  end if;

  delete from public.datasets where id = p_dataset_id;

  perform public.log_admin_action(
    'dataset_deleted', 'dataset', p_dataset_id::text, jsonb_build_object('title', title)
  );

  return path;
end;
$$;

-- ---------- 8. Admin actions on members ----------
create or replace function public.admin_set_verified(p_user_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;

  update public.profiles set is_verified = coalesce(p_value, false) where id = p_user_id;

  if not found then
    raise exception 'Member not found';
  end if;

  perform public.log_admin_action(
    'member_verified', 'member', p_user_id::text, jsonb_build_object('verified', coalesce(p_value, false))
  );
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;

  if coalesce(p_role, '') not in ('member', 'moderator', 'admin') then
    raise exception 'Choose a valid role';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  update public.profiles set user_role = p_role where id = p_user_id;

  if not found then
    raise exception 'Member not found';
  end if;

  perform public.log_admin_action(
    'member_role', 'member', p_user_id::text, jsonb_build_object('role', p_role)
  );
end;
$$;

create or replace function public.admin_set_suspended(p_user_id uuid, p_value boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot suspend yourself';
  end if;

  select user_role into target_role from public.profiles where id = p_user_id;

  if not found then
    raise exception 'Member not found';
  end if;

  if target_role = 'admin' and coalesce(p_value, false) then
    raise exception 'Admins cannot be suspended. Change their role first';
  end if;

  update public.profiles set is_suspended = coalesce(p_value, false) where id = p_user_id;

  perform public.log_admin_action(
    case when coalesce(p_value, false) then 'member_suspended' else 'member_restored' end,
    'member', p_user_id::text,
    jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''))
  );
end;
$$;

-- ---------- 9. Staff view: members, with email ----------
create or replace function public.admin_list_members(
  p_search  text,
  p_limit   integer,
  p_offset  integer
)
returns table (
  id               uuid,
  username         text,
  full_name        text,
  email            text,
  country          text,
  user_role        text,
  is_verified      boolean,
  is_suspended     boolean,
  created_at       timestamptz,
  datasets_count   bigint,
  purchases_count  bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  term text := trim(coalesce(p_search, ''));
  lim  integer := greatest(1, least(coalesce(p_limit, 25), 100));
  off  integer := greatest(0, coalesce(p_offset, 0));
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;

  return query
  select pr.id,
         pr.username,
         pr.full_name,
         u.email::text,
         pr.country,
         pr.user_role,
         pr.is_verified,
         pr.is_suspended,
         pr.created_at,
         (select count(*) from public.datasets d where d.owner_id = pr.id),
         (select count(*) from public.dataset_purchases b where b.buyer_id = pr.id and b.status = 'paid')
  from public.profiles pr
  left join auth.users u on u.id = pr.id
  where term = ''
     or pr.username ilike '%' || term || '%'
     or pr.full_name ilike '%' || term || '%'
     or u.email ilike '%' || term || '%'
  order by pr.created_at desc
  limit lim offset off;
end;
$$;

-- ---------- 10. Staff view: overview numbers ----------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  earned numeric;
  paid   numeric;
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;

  select coalesce(sum(seller_amount), 0) into earned
  from public.dataset_purchases where status = 'paid' and currency = 'NGN';

  select coalesce(sum(amount), 0) into paid
  from public.payouts where currency = 'NGN';

  return jsonb_build_object(
    'members',            (select count(*) from public.profiles),
    'members_7d',         (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'suspended',          (select count(*) from public.profiles where is_suspended),
    'datasets_total',     (select count(*) from public.datasets),
    'datasets_published', (select count(*) from public.datasets where status = 'published'),
    'datasets_removed',   (select count(*) from public.datasets where status = 'removed'),
    'downloads',          (select coalesce(sum(download_count), 0) from public.datasets),
    'sales_count',        (select count(*) from public.dataset_purchases where status = 'paid'),
    'gross',              (select coalesce(sum(amount), 0) from public.dataset_purchases where status = 'paid' and currency = 'NGN'),
    'commission',         (select coalesce(sum(commission_amount), 0) from public.dataset_purchases where status = 'paid' and currency = 'NGN'),
    'owed_to_sellers',    earned - paid,
    'open_tickets',       (select count(*) from public.support_tickets where status <> 'closed'),
    'open_reports',       (select count(*) from public.reports where status in ('open', 'reviewing'))
  );
end;
$$;

-- ---------- 11. Suspended members: no uploads, edits or downloads ----------
drop policy if exists "Members add their own datasets" on public.datasets;
create policy "Members add their own datasets"
  on public.datasets
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and status in ('draft', 'published')
    and not public.is_suspended()
  );

drop policy if exists "Owners and staff update datasets" on public.datasets;
create policy "Owners and staff update datasets"
  on public.datasets
  for update
  to authenticated
  using ((owner_id = auth.uid() and not public.is_suspended()) or public.is_staff())
  with check ((owner_id = auth.uid() and not public.is_suspended()) or public.is_staff());

drop policy if exists "Members upload their own dataset files" on storage.objects;
create policy "Members upload their own dataset files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.is_suspended()
  );

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

  if public.is_suspended() then
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

-- ---------- 12. Staff access to files ----------
drop policy if exists "Staff read all dataset files" on storage.objects;
create policy "Staff read all dataset files"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'datasets' and public.is_staff());

drop policy if exists "Admins delete dataset files" on storage.objects;
create policy "Admins delete dataset files"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'datasets' and public.is_admin());

-- ---------- 13. Who may call each function ----------
revoke execute on function public.create_ticket(text, text, text, uuid) from public, anon;
revoke execute on function public.reply_ticket(uuid, text) from public, anon;
revoke execute on function public.set_ticket_status(uuid, text) from public, anon;
revoke execute on function public.create_report(text, uuid, text, text) from public, anon;
revoke execute on function public.resolve_report(uuid, text, text) from public, anon;
revoke execute on function public.admin_set_dataset_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_delete_dataset(uuid) from public, anon;
revoke execute on function public.admin_set_verified(uuid, boolean) from public, anon;
revoke execute on function public.admin_set_role(uuid, text) from public, anon;
revoke execute on function public.admin_set_suspended(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_list_members(text, integer, integer) from public, anon;
revoke execute on function public.admin_overview() from public, anon;

grant execute on function public.create_ticket(text, text, text, uuid) to authenticated;
grant execute on function public.reply_ticket(uuid, text) to authenticated;
grant execute on function public.set_ticket_status(uuid, text) to authenticated;
grant execute on function public.create_report(text, uuid, text, text) to authenticated;
grant execute on function public.resolve_report(uuid, text, text) to authenticated;
grant execute on function public.admin_set_dataset_status(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_dataset(uuid) to authenticated;
grant execute on function public.admin_set_verified(uuid, boolean) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_set_suspended(uuid, boolean, text) to authenticated;
grant execute on function public.admin_list_members(text, integer, integer) to authenticated;
grant execute on function public.admin_overview() to authenticated;

notify pgrst, 'reload schema';