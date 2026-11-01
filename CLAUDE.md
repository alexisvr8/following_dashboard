# Metodología de Seguimiento Xtract

Dashboard personal de un solo usuario. Sin auth. Self-hosted (no Vercel).

## Stack
Next.js 16 (App Router, TS) · Supabase (Postgres) · Tailwind v4 + shadcn/ui · pnpm
Fuente: Inter (`--font-sans`, next/font/google, en `app/layout.tsx`).

## Navegación
Nav horizontal centrada en el header sticky (`components/layout/{AppHeader,MainNav}.tsx`; en <md
se vuelve menú desplegable `MobileNav`). Sin sidebar. 4 secciones (+ detalle `/cuentas/[id]`):
- `/` Dashboard (**datos reales**, clientes `assigned`/`unassigned` de `.data/clients.json` vía
  `clientsToBoard`). Orden: **Números** `KeyNumbers` → **Capacidad** `WeekPlanner` → **Seguimiento**
  `FollowupAlerts` → **Cuentas** `AccountsSplitView` (client, buscador por nombre/dominio/ERP).
  Capacidad = `WeekPlanner` (planificador por día, meta = cerrar
  pendientes al viernes: veredicto core/flex/deficit, métricas (reuniones, libre normal + flex,
  pendientes, meta diaria), fila por día con timeline [reuniones Calendar, almuerzo,
  accionables proyectados, zonas flex] expandible a agenda + chips de huecos libres; toggle
  Esta/Próxima `?semana=0|1` (default próxima si no queda jornada); botón Actualizar =
  `router.refresh()`; ⚙ `WorkSettingsDialog`); `AccountCard` → `/cuentas/[id]`. Motor
  `lib/utils/week-plan.ts`: ventana flexible `workStart–workEnd` (9–18) con horario normal
  `coreStart–coreEnd` (10–17:30); ocupado = eventos de Calendar (`listEventsBetween`, sin
  "disponible"/declinados) + almuerzo = eventos /almuerzo|lunch|comida/ del día (fallback
  `lunchStart`/`lunchMinutes` marcado "estimado"); accionables propios pendientes de la última
  reunión × h/accionable, greedy por urgencia (cuenta con reunión próxima primero): 1ª pasada
  huecos normales de toda la semana, 2ª pasada flex; resto = déficit. Reunión ↔ cuenta por
  dominio/email. Helpers `toMinutes`/`isOwnActionable` en `lib/utils/capacity.ts`. Settings en
  `.data/settings.json` (`lib/store/settings-store.ts`, `GET/PUT /api/settings`; 0.5h/accionable,
  alias "[Alexis Vásquez R]"). Colores `--series-1/2` (validados dataviz) en `globals.css`.
  Aviso con link a `/clientes` si hay pendientes de validar.
- `/cuentas/[id]`: detalle de cuenta (`components/cuentas/*`): `LastMeetingPanel` (engagement
  ring/barra en vivo, duración, accionables tildables), `ParticipantsList` (roles de
  `lib/utils/participants.ts`: owner Xtract / referentes = dominio coincide con nombre de la
  empresa / equipo Xtract = dominio del owner / otros; estrella = override manual en
  `profile.referentOverrides`), historial, `AccountProfileForm` (nombre, nombre en correos,
  ERP, owner, notas para el agente → `profile`). Botones: último mail en Gmail y
  `/tablero?open=<id>` (abre la card de esa cuenta).
- `/tablero` Tablero Seguimiento: kanban de cuentas por `tracking_status`
  (`components/tablero/{TrackingBoard,TrackingColumn,TrackingCard,TrackingDialog}.tsx`),
  drag-and-drop propio con pointer events (sin HTML5 DnD ni librería): overlay en portal con
  tilt por velocidad, placeholder, FLIP con Web Animations, autoscroll, Esc cancela, touch con
  long-press. Orden dentro de columna solo local; `?open=<id>` abre el Dialog. Columnas = pipeline de tareas (`lib/tracking.ts`):
  `tasks_generated` (Tareas Generadas) → `tasks_in_progress` (Tareas en Curso) →
  `tasks_priority` (Tareas con Prioridad) → `tasks_done` (Tareas Finalizadas). El status
  **Datos reales**: solo clientes con `status: "assigned"` de `.data/clients.json`,
  proyectados por `lib/utils/clients-to-board.ts` (accionables = `nextSteps` de la ÚLTIMA
  minuta; ids prefijados con el id del cliente; tildarlos persiste en `doneTicketIds` vía
  `TicketItem` → `PATCH /api/clients/[id]` y alimenta el engagement).
  Status inicial `tasks_generated`; el drag-and-drop persiste vía `PATCH /api/clients/[id]`.
  (`lib/utils/tracking-heuristic.ts` queda sin uso en el Tablero.) Cada `TrackingCard`
  muestra nombre de cuenta, fecha de última reunión y % de engagement (barra `Progress`)
  en la cara visible; click abre un `Dialog` (`components/ui/dialog.tsx`, base
  `@base-ui/react`) con los accionables (`tickets`) de la última reunión (`meetings`) de
  esa cuenta, resuelto vía `getLatestMeeting` (`lib/utils/meetings.ts`) +
  `tickets.meetingId`.
- `/clientes`: validación de clientes descubiertos en mails de Gemini Notes
  (`components/clientes/{ClientsReview,ClientCandidateCard}.tsx`): botón de escaneo (60 días),
  tabs Por validar/Asignados/No asignados/Ignorados, nombre editable, y lista de reuniones sin
  cliente detectado.
- `/conexiones`: estado en vivo de las 5 integraciones (`IntegrationsGrid`/
  `IntegrationStatusCard`, reusados del Dashboard original), llamando directamente a los
  handlers `GET` de `/api/integrations/*` (sin fetch HTTP, in-process).

Dark mode vía `next-themes` (`ThemeProvider`/`ThemeToggleButton` en
`components/layout/`), toggle en `AppHeader`; tokens OKLCH ya definidos en
`app/globals.css` (`:root`/`.dark`).

## Comandos
pnpm install · pnpm dev · pnpm build · pnpm lint

## DB (Supabase) — resumen
Proyecto Supabase aún no creado; `lib/supabase/{client,server}.ts` y
`supabase/migrations/0001_init.sql` listos para cuando se pegue
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` en `.env.local`
(ver `.env.local.example`). Fase 1 corre sobre `lib/mock/*`, no sobre Supabase real.

- **accounts**: cuentas, `contact_email` (match con hilos de Gmail/eventos de Calendar),
  `is_assigned`, `time_score`/`difficulty_score` (clasificador
  de prioridad), `calendar_minutes_planned`/`execution_minutes_actual` (gauge),
  `last_activity_at` (→ churn-risk), `engagement_percent` (cache, derivado de tickets),
  `tracking_status` (tasks_generated/tasks_in_progress/tasks_priority/tasks_done, ver
  `lib/tracking.ts`) y `last_note_summary` (texto libre) para el Tablero Seguimiento.
- **tickets**: accionables semanales por cuenta, `week_start_date`, `is_done` (→ % engagement),
  `meeting_id` (nullable, FK a `meetings`) para asociar el accionable a la reunión que lo generó.
- **integrations_status**: estado de gmail/calendar/notion/xtract/gemini_notes.
- **meetings**: minutas, `sentiment`, `followup_draft`, `followup_reminder_at`.
- **weekly_runs**: log de corridas del cron semanal.

Churn-risk y % engagement son DERIVADOS (`lib/utils/churn.ts`, `engagement.ts`),
no columnas de verdad única salvo el cache en `accounts.engagement_percent`.
Clasificador de prioridad: `lib/utils/priority-classifier.ts` (matriz 2x2
tiempo/dificultad → quick_win/major_project/fill_in/thankless_task), no se persiste.

## Rutas API (Fase 1 = stubs; Fase 1.5 = Google real, ver abajo)
- `GET /api/integrations/{gmail,calendar,gemini-notes}` → real: `connected` si hay
  `.data/google-tokens.json` (gemini-notes además exige scope `drive.readonly`).
- `GET /api/integrations/notion` → real read-only (`lib/integrations/notion.ts`, fetch sin SDK,
  `Notion-Version 2022-06-28`): `connected` si hay token. Auth vía OAuth público
  (`GET /api/auth/notion/{connect,callback}`, env `NOTION_OAUTH_CLIENT_ID/SECRET`,
  `NOTION_REDIRECT_URI`; token en `.data/notion-tokens.json`, `notion-token-store.ts`) — el
  workspace no permite token interno; `NOTION_TOKEN` queda como fallback. `GET /api/integrations/xtract` sigue mock `not_configured`.
- `GET /api/accounts/discover` → cuentas candidatas desde Notion filtradas por
  `NOTION_PROP_SPECIALIST`=`NOTION_SPECIALIST_VALUE` (people se filtra en cliente). Proyección
  mínima `{notionPageId,name,domain,stage,specialist}`, no persiste. `?schema=1` lista
  propiedades/tipos de la base. Próximo: validación manual → `.data/confirmed-accounts.json`.
- `POST /api/cron/weekly-actionables` → valida header `x-cron-secret`, responde stub.
- `POST /api/meetings/[id]/generate-followup` → draft real con tickets abiertos de la
  reunión; si la cuenta tiene `contact_email` y Google está conectado, crea el draft en
  Gmail de verdad. `sentiment` sigue siendo mock.
- `POST /api/timeblocking/suggest` → huecos reales vía Calendar free/busy si Google está
  conectado; si no, fallback a slots mock.
- `POST /api/integrations/gemini-notes/sync` → trigger manual (sin cron): busca Docs
  "Notes by Gemini" en Drive y crea `Meeting`s en el store runtime
  (`lib/store/meetings-runtime.ts`, en memoria, sin Supabase) matcheando por dominio de
  `contact_email`.
- `POST /api/clients/discover?days=60` → `lib/integrations/gemini-mail.ts`: mails de
  `gemini-notes@google.com` (env `GEMINI_NOTES_SENDER` opcional) → evento de Calendar (por Doc
  adjunto, fallback título+fecha ±1d) → asistentes externos al dominio propio → cliente agrupado
  por dominio (freemail: por email). Texto del Doc → `lib/utils/gemini-notes-parser.ts` (reglas,
  sin LLM: `Resumen`/`Próximos pasos`). Retry con backoff ante rate limit de Gmail. Merge no
  destructivo en `.data/clients.json` (`lib/store/clients-store.ts`); re-escaneo salta mails ya
  procesados.
- `PATCH /api/clients/[id]` → `{status?, name?, trackingStatus?}`, `{ticketId, isDone}` o
  `{profile: {emailName?, erp?, ownerEmail?, notes?, referentOverrides?}, name?}`.
- `POST /api/clients/sync-activity` (body opcional `{ids}`; default asignados+no asignados) →
  `lib/integrations/client-activity.ts`: por cliente guarda `activity` en `.data/clients.json`:
  `lastMail`/`recentMails` = últimos mails REALES en cualquier dirección (`direction`
  client/team/me; cliente = dominio + referentes + invitados externos; team = dominio propio),
  descartando invitaciones/respuestas de Calendar, auto-respuestas y minutas
  (`lib/utils/mail-classify.ts`); `lastInboundMail` = último del cliente con `requests`
  (pedidos/preguntas por reglas); `relatedTicketIds` (match por palabras clave con la última
  minuta: si el mail es nuestro → "posiblemente resuelto"); hilos recientes; última reunión de
  Calendar (`hasNotes`). Auto-tilda follow-up (mail mío post-reunión) y "Responder" (mail
  nuestro posterior al del cliente). Botones en `/clientes`, Dashboard y `ActivityPanel`.
- Accionables vigentes (`lib/utils/actionables.ts`, `accountActionables`): última minuta + abiertos
  (o cerrados con fecha) de hasta 3 minutas previas en 28 días, sin duplicar lo que la nueva
  minuta re-lista (`keywordSimilarity`); solo minutas que fueron "la última" desde
  `CARRY_OVER_SINCE` (2026-10-31). Usado por `clientsToBoard`, `week-plan`, alertas, sync y
  borrador. `doneTicketAt` (fecha de cierre) + `ticketsUpdatedAt` en `ClientRecord`.
  UI `ActionablesList` (cuenta y Dialog del Tablero): pendientes por semana (última reunión /
  arrastrados / nuevos de mails) + "Finalizadas" con fecha. Al tildar en la cuenta se hace
  `router.refresh()` y aparece link al borrador de seguimiento regenerado.
- Accionables de mail (`lib/utils/mail-tickets.ts`): si el último mail del cliente es posterior a
  la última reunión → "Responder a X" + 1 ticket por pedido (`mailTicketId`). Entran en
  `clientsToBoard`, `week-plan` y alertas.
- Alertas (`lib/utils/followup-alerts.ts`, `FollowupAlerts` en Dashboard, sección Seguimiento):
  solo asignados; `client_waiting` (mail del cliente sin responder ≥1 día hábil),
  `no_progress` / `awaiting_client` (sin mails ni reuniones ≥ `settings.staleBusinessDays`
  (default 2) días hábiles con accionables abiertos).
- Borradores (`lib/utils/followup.ts`, `getDraft(kind)`): `meeting` = resumen + próximos pasos de
  la última minuta; `status` = actualización de avance (completado esta semana con fecha / en curso
  nuestro con arrastrados marcados / pedidos del cliente / pendiente del cliente / otros); si
  cambiaron tickets o llegó un mail después de la edición guardada se regenera (`regenerated`). Ticket sintético follow-up `followupTicketId`.
  `PUT|POST /api/clients/[id]/followup` `{kind, meetingId, ...}` guarda en
  `client.followups[followupKey(kind, id)]` / crea draft en Gmail (`createThreadDraft`: dentro del
  hilo elegido con Re:/In-Reply-To, o mail nuevo). Nunca envía. UI: tabs en `/cuentas/[id]`
  (`?borrador=status#borradores`), `FollowupComposer` (hilo, Para, editar, Copiar, Regenerar).
- `POST /api/cron/daily-followup` (header `x-cron-secret`, cron externo diario hábil): sync de
  asignados + alertas + 1 draft de actualización en Gmail por cuenta alertada y movimiento
  (dedupe `autoFor`); `?drafts=0` solo sincroniza.
- `GET /api/clients/[id]/last-mail` → 302 al último hilo de Gmail con el dominio/emails del
  cliente (excluye Gemini Notes); fallback a búsqueda en Gmail.
- Cada `DiscoveredMeeting` guarda `attendees` (Calendar, sin salas); `ClientsFile.ownerEmail` =
  cuenta que escaneó. El re-escaneo hace backfill de ambos (por Doc o `título|fecha`).
  El escaneo también hace backfill de `durationMinutes` por Doc adjunto al evento.
- `GET /api/accounts/[id]/priority` → usa `classifyAccountPriority` real sobre mock data.

## Integración Google (Gmail + Calendar + Drive) — Fase 1.5
OAuth único (mismo client) para los tres: scopes `gmail.readonly`, `gmail.compose`,
`calendar.readonly`, `calendar.events`, `drive.readonly` (`lib/integrations/google-client.ts`).
Flujo: `GET /api/auth/google/connect` → consentimiento → `GET /api/auth/google/callback`
guarda tokens en `.data/google-tokens.json` (gitignored; **no Supabase todavía**, por
decisión explícita — se resetea si se borra el archivo o se reinicia en otro filesystem).
Wrappers: `lib/integrations/{gmail,calendar,drive}.ts`. Env vars nuevas:
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`.
Pendiente explícito: persistir en Supabase cuando exista el proyecto, extracción de
accionables por LLM desde el texto de la minuta, análisis de sentimiento real, envío
real de emails (hoy solo se crea el draft).

## Cron externo
No hay Vercel Cron. Un cron externo (GitHub Actions scheduled workflow o cron de VPS)
debe hacer `POST` cada lunes a `/api/cron/weekly-actionables` y cada día hábil (p. ej. 8:30) a
`/api/cron/daily-followup`, ambos con header `x-cron-secret: $CRON_SECRET`.

## Regla de tokens
Para ahorrar tokens, proveer respuestas directas sin relleno, generar exclusivamente los
bloques de código modificados indicando la línea (nunca reescribir archivos enteros) y
actualizar este archivo ante cualquier cambio estructural.

## Estado
Fase 1 completa: arquitectura + UI con mock data, stubs de integraciones y automatización.
Fase 1.5 en curso: Gmail + Calendar + Drive (Gemini Notes) conectados vía OAuth real,
sin proyecto Supabase todavía (tokens y meetings sincronizados viven en archivo local /
memoria). Notion y Xtract (facturas, ventana de 90 días) siguen mock, pendientes de
endpoints/API keys por cliente.
UI: nav en header (sin sidebar) + dark mode + página `/conexiones` dedicada ya shippeados.
Clientes reales: `/clientes` + Tablero sobre `.data/clients.json` (Gemini Notes, 60 días);
el Dashboard también usa datos reales. `executionMinutesActual` sigue en 0 (sin fuente). El
pipeline de 4 columnas del Tablero usa la heurística placeholder de
`lib/utils/tracking-heuristic.ts` hasta que exista el agente LLM que interprete minutas
de verdad (ver "Pendiente explícito" en Integración Google).
