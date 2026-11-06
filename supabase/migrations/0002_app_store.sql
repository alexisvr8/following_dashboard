-- Persistencia real de la app (reemplaza `.data/*.json`). El modelo de 0001 (Fase 1, relacional)
-- no se usa: el estado vigente es `ClientRecord` anidado, así que va una fila por cliente en jsonb.
-- Acceso solo desde el servidor con la service_role (RLS activo y sin políticas: la anon key no ve nada).

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists clients (
  id text primary key,
  -- Orden de alta (el mismo que tenía `clients.json`).
  seq bigint generated always as identity,
  status text not null,
  name text not null,
  domain text not null,
  data jsonb not null,
  -- Control optimista: cada escritura exige la versión leída y la incrementa.
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists clients_status_idx on clients (status);
drop trigger if exists clients_set_updated_at on clients;
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();

-- Claves: clients_meta {lastScanAt, ownerEmail}, clients_unmatched [DiscoveredMeeting],
-- settings, sync_status, google_tokens, notion_tokens.
create table if not exists app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
drop trigger if exists app_state_set_updated_at on app_state;
create trigger app_state_set_updated_at before update on app_state
  for each row execute function set_updated_at();

alter table clients enable row level security;
alter table app_state enable row level security;
