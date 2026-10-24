-- SANTACHAT MVP schema. Run in Supabase SQL Editor or with Supabase CLI.
-- This migration intentionally implements profiles, direct conversations, messages, and private image storage.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text,
  avatar_url text,
  bio text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,24}$')
);
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));
create index if not exists profiles_username_prefix_idx on public.profiles (username text_pattern_ops);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id, conversation_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint messages_body_not_blank check (length(trim(body)) > 0)
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index if not exists messages_sender_idx on public.messages(sender_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  desired_username text;
  desired_display text;
begin
  desired_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  desired_display := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if desired_username !~ '^[a-z0-9_]{3,24}$' then
    desired_username := 'user_' || replace(new.id::text, '-', '');
  end if;
  insert into public.profiles(id, username, display_name)
  values(new.id, desired_username, coalesce(desired_display, desired_username))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_santachat on auth.users;
create trigger on_auth_user_created_santachat
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_conversation_member(target_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = target_conversation and cm.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create or replace function public.find_or_create_direct_conversation(other_user_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing_id uuid;
  created public.conversations;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if other_user_id is null or other_user_id = me then raise exception 'Invalid recipient'; end if;
  if not exists(select 1 from public.profiles p where p.id = other_user_id) then raise exception 'User not found'; end if;

  select c.id into existing_id
  from public.conversations c
  join public.conversation_members a on a.conversation_id = c.id and a.user_id = me
  join public.conversation_members b on b.conversation_id = c.id and b.user_id = other_user_id
  where c.kind = 'direct'
    and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  limit 1;

  if existing_id is not null then
    select * into created from public.conversations where id = existing_id;
    return created;
  end if;

  insert into public.conversations(kind) values('direct') returning * into created;
  insert into public.conversation_members(conversation_id, user_id)
  values(created.id, me), (created.id, other_user_id);
  return created;
end;
$$;
revoke all on function public.find_or_create_direct_conversation(uuid) from public;
grant execute on function public.find_or_create_direct_conversation(uuid) to authenticated;

create or replace function public.bump_conversation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists on_message_insert_bump_conversation on public.messages;
create trigger on_message_insert_bump_conversation
after insert on public.messages
for each row execute procedure public.bump_conversation_updated_at();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Profiles visible to signed-in users" on public.profiles;
create policy "Profiles visible to signed-in users"
on public.profiles for select to authenticated using (true);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and username ~ '^[a-z0-9_]{3,24}$'
);

drop policy if exists "Users can view conversations they belong to" on public.conversations;
create policy "Users can view conversations they belong to"
on public.conversations for select to authenticated
using (public.is_conversation_member(id));

drop policy if exists "Members can view membership list" on public.conversation_members;
create policy "Members can view membership list"
on public.conversation_members for select to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages"
on public.messages for select to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can send messages as themselves" on public.messages;
create policy "Members can send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
  and char_length(trim(body)) between 1 and 5000
);

drop policy if exists "Senders can edit own messages" on public.messages;
create policy "Senders can edit own messages"
on public.messages for update to authenticated
using (sender_id = (select auth.uid()))
with check (sender_id = (select auth.uid()) and public.is_conversation_member(conversation_id));

drop policy if exists "Senders can delete own messages" on public.messages;
create policy "Senders can delete own messages"
on public.messages for delete to authenticated
using (sender_id = (select auth.uid()));

-- Private storage bucket for chat images (5 MB is also checked in frontend).
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Conversation members can upload chat images" on storage.objects;
create policy "Conversation members can upload chat images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "Conversation members can read chat images" on storage.objects;
create policy "Conversation members can read chat images"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Owners can delete their uploaded chat images" on storage.objects;
create policy "Owners can delete their uploaded chat images"
on storage.objects for delete to authenticated
using (bucket_id = 'chat-media' and (storage.foldername(name))[2] = (select auth.uid())::text);

-- Realtime needs messages in the publication. If already included, skip safely.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then raise notice 'supabase_realtime publication not found; enable Realtime for public.messages in dashboard.';
end $$;

grant select, update on public.profiles to authenticated;
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
