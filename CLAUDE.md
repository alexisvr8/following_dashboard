# Metodología de Seguimiento Xtract

Dashboard personal de un solo usuario. Sin auth. Self-hosted (no Vercel).

## Stack
Next.js 16 (App Router, TS) · Supabase (Postgres) · Tailwind v4 + shadcn/ui · pnpm
Fuente: Inter (`--font-sans`, next/font/google, en `app/layout.tsx`).

## Navegación
Sidebar fijo (`components/layout/Sidebar.tsx`) con 2 secciones:
- `/` Dashboard: `MetricsOverview` (cuentas asignadas, en riesgo, engagement promedio,
  tiempo dedicado) + `AccountsSplitView` + tickets + integraciones.
- `/tablero` Tablero Seguimiento: kanban de cuentas por `tracking_status`
  (`components/tablero/{TrackingBoard,TrackingColumn,TrackingCard}.tsx`), drag-and-drop
  nativo HTML5 (sin librería externa). Estado local en Fase 1, sin persistencia.

## Comandos
pnpm install · pnpm dev · pnpm build · pnpm lint

## DB (Supabase) — resumen
Proyecto Supabase aún no creado; `lib/supabase/{client,server}.ts` y
`supabase/migrations/0001_init.sql` listos para cuando se pegue
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` en `.env.local`
(ver `.env.local.example`). Fase 1 corre sobre `lib/mock/*`, no sobre Supabase real.

- **accounts**: cuentas, `is_assigned`, `time_score`/`difficulty_score` (clasificador
  de prioridad), `calendar_minutes_planned`/`execution_minutes_actual` (gauge),
  `last_activity_at` (→ churn-risk), `engagement_percent` (cache, derivado de tickets),
  `tracking_status` (no_contact/in_progress/waiting_client/at_risk/closed_ok, ver
  `lib/tracking.ts`) y `last_note_summary` (texto libre) para el Tablero Seguimiento.
- **tickets**: accionables semanales por cuenta, `week_start_date`, `is_done` (→ % engagement).
- **integrations_status**: estado de gmail/calendar/notion/xtract/gemini_notes.
- **meetings**: minutas, `sentiment`, `followup_draft`, `followup_reminder_at`.
- **weekly_runs**: log de corridas del cron semanal.

Churn-risk y % engagement son DERIVADOS (`lib/utils/churn.ts`, `engagement.ts`),
no columnas de verdad única salvo el cache en `accounts.engagement_percent`.
Clasificador de prioridad: `lib/utils/priority-classifier.ts` (matriz 2x2
tiempo/dificultad → quick_win/major_project/fill_in/thankless_task), no se persiste.

## Rutas API (Fase 1 = stubs, sin lógica de negocio real)
- `GET /api/integrations/{gmail,calendar,notion,xtract,gemini-notes}` → mock `not_configured`.
- `POST /api/cron/weekly-actionables` → valida header `x-cron-secret`, responde stub.
- `POST /api/meetings/[id]/generate-followup` → contrato draft+sentiment+reminder, mock.
- `POST /api/timeblocking/suggest` → contrato de huecos sugeridos, mock.
- `GET /api/accounts/[id]/priority` → usa `classifyAccountPriority` real sobre mock data.

## Cron externo
No hay Vercel Cron. Un cron externo (GitHub Actions scheduled workflow o cron de VPS)
debe hacer `POST` cada lunes a `/api/cron/weekly-actionables` con header
`x-cron-secret: $CRON_SECRET`.

## Regla de tokens
Para ahorrar tokens, proveer respuestas directas sin relleno, generar exclusivamente los
bloques de código modificados indicando la línea (nunca reescribir archivos enteros) y
actualizar este archivo ante cualquier cambio estructural.

## Estado
Fase 1 completa: arquitectura + UI con mock data, stubs de integraciones y automatización,
sin lógica de negocio real ni proyecto Supabase conectado todavía.
