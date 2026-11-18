-- ==========================================================================
-- Employee profile photos, licence expiry dates and personal documents
-- Run ONCE in the Supabase SQL Editor, after create-employees.sql. Safe to re-run.
--
-- * Profile photo: a small JPEG stored on the employee's own row (like the
--   vehicle photo), so it shares that row's approved-users-only access.
-- * Documents: one row per file here; the file itself goes in the existing
--   private "documents" storage bucket under employees/<employee id>/, which
--   only approved users can read, upload or delete (update-documents-storage.sql).
--   Files are only ever opened through short-lived signed links.
-- ==========================================================================

BEGIN;

alter table public.employees add column if not exists photo text not null default '';

-- Licence & ticket expiry dates: { "<licence name>": "YYYY-MM-DD" }. A licence
-- with no entry doesn't expire (e.g. White Card). Added after this file was
-- first published — re-running the whole file is safe.
alter table public.employees add column if not exists "licenceExpiries" jsonb not null default '{}'::jsonb;

create table if not exists public.employee_documents (
  id              text primary key,
  "employeeId"    text not null references public.employees(id) on delete cascade,
  name            text not null,
  "storagePath"   text not null,
  "contentType"   text not null default '',
  "sizeBytes"     bigint not null default 0,
  "uploadedAt"    timestamptz,
  "uploadedBy"    text not null default ''
);

create index if not exists employee_documents_employee on public.employee_documents ("employeeId");

revoke all on table public.employee_documents from anon;
grant select, insert, update, delete on table public.employee_documents to authenticated;

alter table public.employee_documents enable row level security;

drop policy if exists "approved users full access" on public.employee_documents;
create policy "approved users full access" on public.employee_documents
  for all to authenticated using (is_approved()) with check (is_approved());

COMMIT;
