-- Run this ONCE in Supabase SQL Editor before the migration.
-- https://supabase.com/dashboard → your project → SQL Editor → New query → paste → Run

-- Enable row-level security and create a permissive policy so the anon key can read/write.
-- (The CRM uses the publishable/anon key; this is safe for a single-user CRM.)

alter table if exists accounts       enable row level security;
alter table if exists contacts       enable row level security;
alter table if exists deals          enable row level security;
alter table if exists activities     enable row level security;
alter table if exists emails         enable row level security;
alter table if exists referrals      enable row level security;
alter table if exists deal_contacts  enable row level security;

-- Drop any old policies with this name first (idempotent)
drop policy if exists "allow_all" on accounts;
drop policy if exists "allow_all" on contacts;
drop policy if exists "allow_all" on deals;
drop policy if exists "allow_all" on activities;
drop policy if exists "allow_all" on emails;
drop policy if exists "allow_all" on referrals;
drop policy if exists "allow_all" on deal_contacts;

create policy "allow_all" on accounts       for all to anon, authenticated using (true) with check (true);
create policy "allow_all" on contacts       for all to anon, authenticated using (true) with check (true);
create policy "allow_all" on deals          for all to anon, authenticated using (true) with check (true);
create policy "allow_all" on activities     for all to anon, authenticated using (true) with check (true);
create policy "allow_all" on emails         for all to anon, authenticated using (true) with check (true);
create policy "allow_all" on referrals      for all to anon, authenticated using (true) with check (true);
create policy "allow_all" on deal_contacts  for all to anon, authenticated using (true) with check (true);

-- Make sure upserts can match on primary key
-- (no-op if the constraints already exist)

select 'Supabase setup complete — run migrate-from-salesforce.mjs now' as status;
