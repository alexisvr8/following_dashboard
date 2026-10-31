create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Cuentas / clientes
create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_assigned boolean not null default true,
  time_score smallint not null default 1 check (time_score between 1 and 5),
  difficulty_score smallint not null default 1 check (difficulty_score between 1 and 5),
  calendar_minutes_planned integer not null default 0,
  execution_minutes_actual integer not null default 0,
  engagement_percent numeric(5,2),
  last_activity_at timestamptz,
  tracking_status text not null default 'no_contact'
    check (tracking_status in ('no_contact','in_progress','waiting_client','at_risk','closed_ok')),
  last_note_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger accounts_set_updated_at before update on accounts
  for each row execute function set_updated_at();

-- Tickets / accionables semanales
create table tickets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  title text not null,
  description text,
  week_start_date date not null,
  is_done boolean not null default false,
  done_at timestamptz,
  source text not null default 'manual'
    check (source in ('manual','gmail','calendar','notion','xtract')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_account_week_idx on tickets(account_id, week_start_date);
create trigger tickets_set_updated_at before update on tickets
  for each row execute function set_updated_at();

-- Estado de conexión de integraciones
create table integrations_status (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null unique
    check (integration_key in ('gmail','calendar','notion','xtract','gemini_notes')),
  status text not null default 'not_configured'
    check (status in ('not_configured','connected','error')),
  last_synced_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger integrations_set_updated_at before update on integrations_status
  for each row execute function set_updated_at();

-- Minutas / reuniones
create table meetings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  title text not null,
  meeting_date timestamptz not null,
  source text not null default 'manual' check (source in ('manual','gemini_notes')),
  raw_notes text,
  sentiment text check (sentiment in ('positive','neutral','negative')),
  followup_draft text,
  followup_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meetings_account_date_idx on meetings(account_id, meeting_date desc);
create trigger meetings_set_updated_at before update on meetings
  for each row execute function set_updated_at();

-- Log de corridas del cron semanal
create table weekly_runs (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null unique,
  status text not null default 'pending' check (status in ('pending','success','error')),
  executed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
