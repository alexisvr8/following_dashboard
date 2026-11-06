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
  `FollowupAlerts` → **Cuentas** `AccountsSplitView` (client, buscador por nombre/dominio/ERP; cards ordenadas por
  `lastMovement` de `followup-alerts.ts` [último mail, minuta o evento realizado], con títulos Hoy/Ayer/Esta semana/Anteriores).
  Capacidad = `WeekPlanner` (planificador por día, meta = cerrar
  pendientes al viernes: veredicto core/flex/deficit, métricas (reuniones, libre normal + flex,
  pendientes, meta diaria), calendario vertical estilo Google Calendar: columna por día y eje de
  horas [reuniones Calendar, almuerzo, accionables proyectados, zonas flex; solapes en carriles,
  `layoutBlocks`]; click en el encabezado del día abre debajo agenda + chips de huecos libres; toggle
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
- `/cuentas/[id]`: detalle de cuenta (`components/cuentas/*`). En `lg` entra en una pantalla (`100dvh` menos el header, scroll por
  columna; en móvil se apila). `AccountWorkspace`: franja con engagement en vivo y métricas de la última reunión; izquierda borradores
  (`#borradores`, `FollowupComposer` ocupa el alto, Enviar siempre visible); derecha pestañas Accionables (`LastChain` = reunión + mails
  posteriores, accionables tildables) / Trazabilidad / Participantes / Reuniones, `ParticipantsList` (roles de
  `lib/utils/participants.ts`: owner Xtract / referentes = dominio coincide con nombre de la
  empresa / equipo Xtract = dominio del owner / otros; estrella = override manual en
  `profile.referentOverrides`), historial, `AccountProfileForm` (header de la cuenta + panel desplegable superpuesto: nombre, nombre en correos,
  cómo saludar a cada contacto `contactNames`, ERP, owner, notas → `profile`). Botones: último mail en Gmail y
  `/tablero?open=<id>` (abre la card de esa cuenta).
- `/tablero` Tablero Seguimiento: kanban con **una card abierta por cliente** (ver "Cards del Tablero" abajo)
  (`components/tablero/{TrackingBoard,TrackingColumn,TrackingCard,TrackingDialog}.tsx`),
  drag-and-drop propio con pointer events (sin HTML5 DnD ni librería): overlay en portal con
  tilt por velocidad, placeholder, FLIP con Web Animations, autoscroll, Esc cancela, touch con
  long-press. Orden dentro de columna solo local; `?open=<card o cuenta>` abre el Dialog (de una cuenta, su card abierta más reciente).
  Buscador + filtro Todas/Hoy/Esta semana (local). Entra en una pantalla en `lg`, con scroll por columna. Columnas (`lib/tracking.ts`):
  `tasks_priority` (Prioridad) → `tasks_generated` (Generadas) → `tasks_in_progress` (En curso) → `tasks_done` (Finalizadas).
  **Datos reales**: solo clientes con `status: "assigned"` de `.data/clients.json`,
  proyectados por `lib/utils/clients-to-board.ts` (accionables = `nextSteps` de la ÚLTIMA
  minuta; ids prefijados con el id del cliente; tildarlos persiste en `doneTicketIds` vía
  `TicketItem` → `PATCH /api/clients/[id]` y alimenta el engagement).
  **Cards del Tablero** (`lib/utils/board-cards.ts` servidor, `board-status.ts` puro): `assignCards` recorre reuniones y mails por fecha: lo nuevo se suma a la
  card en curso y solo abre otra si esa ya estaba finalizada cuando llegó (como máximo una abierta por cliente; reabrir una vieja le vuelve a sumar lo posterior).
  `Ticket.sourceId/sourceTitle/...` = origen de cada punto; el Dialog agrupa por origen.
  Estado automático (`resolveCardStatus`): todo tildado → Finalizadas; `priorityReason` (cliente espera respuesta ≥1 día hábil, o
  `staleBusinessDays` sin movimiento ni tildes, salvo que lo último sea un mail nuestro) → Prioridad; algo tildado → En curso; si no, Generadas.
  Mover a mano = `client.boardOverrides[cardId]` (`PATCH {boardCard}`), vale hasta el próximo tildado o hasta que entre algo nuevo. `client.trackingStatus` ya no se usa.
  Finalizadas se muestran en una línea, ordenadas por cierre; las cerradas antes del lunes pasan a `ArchiveDialog` ("Ver archivo"). Se tilda desde la card o el Dialog.
  **Puntos editables** (`ActionablesList` con `editable`, en Tablero y cuenta; `PATCH {actionable: {op: add|edit|remove}}`, `changeActionable`):
  `client.customActionables` / `actionableEdits` / `removedTicketIds`, aplicados en `accountActionables`, `executedHistory` y `mailTickets`, por lo que llegan a
  Capacidad, alertas y borradores (tocan `ticketsUpdatedAt`). Lo nuevo sin `[Dueño]` se guarda a nombre de `ownerAliases[0]`. `isAutoTicket` (follow-up y Responder) no se edita.
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
pnpm install · pnpm dev · pnpm build · pnpm lint · pnpm migrate:supabase · pnpm autostart:{install,restart,logs}

## Persistencia (Supabase o archivo) — resumen
`lib/store/backend.ts`: `usingSupabase()` (`STORE_BACKEND=supabase|file`; vacío = supabase si hay
`SUPABASE_SERVICE_ROLE_KEY`), `getState/setState(key)` sobre `app_state` (o `.data/*.json`). Cliente servidor
`lib/supabase/admin.ts` (service_role, sin cookies: sirve en el scheduler). Esquema vigente
`supabase/migrations/0002_app_store.sql`: `clients` (una fila por cliente: `id`, `seq` = orden, `status`/`name`/`domain`
sueltos, `data jsonb` = `ClientRecord`, `version` para control optimista) y `app_state` (`clients_meta`,
`clients_unmatched`, `settings`, `sync_status`, `google_tokens`, `notion_tokens`). RLS sin políticas: solo service_role.
`clients-store.ts` mantiene su API; los mutadores usan `mutateClient(s)` (lee la fila, aplica, `update … where version`;
ante conflicto relee y reaplica; `SKIP` = sin cambios) y `mutateFileLevel` (altas, sin cliente, meta).
`settings-store`, `sync-status-store`, `google/notion-token-store` → `getState/setState`.
Migrar datos locales: `pnpm migrate:supabase` (`scripts/migrate-to-supabase.mjs`, lee `.env.local`): carga inicial;
`--merge [--dry-run]` combina el `.data/clients.json` de otra PC con la base (`scripts/merge-clients.mjs`: unión de reuniones,
tildados [fecha = primer cierre], accionables propios/ediciones/quitados, cards y borradores por fecha más nueva, perfil;
conflictos de estado/nombre se dejan como en la base y se informan; respaldo en `.data/supabase-backup-*.json`); `--force` pisa.
Local (opción vigente): `pnpm autostart:install|uninstall|restart|logs` (`scripts/autostart.sh`) instala un LaunchAgent
`com.xtract.method` que corre `scripts/start-local.sh` al iniciar sesión (recompila si cambió el commit o
`FORCE_BUILD=1`, luego `next start`; logs en `~/Library/Logs/xtract-method.log`). **No instalado**: macOS (TCC) no deja
a launchd leer `~/Desktop`; solo sirve si el proyecto se mueve fuera de Escritorio/Documentos. Hoy se arranca a mano
(`pnpm dev` o `pnpm build && pnpm start`). Node >=22 (`.nvmrc`).
Servidor (opcional): `Dockerfile` (`NEXT_OUTPUT=standalone`), una sola instancia (candado de sync por proceso), env
`CRON_ENABLED=true`, `TZ`, `APP_USER`/`APP_PASSWORD` → Basic Auth en `proxy.ts` (fuera: callbacks OAuth y POST `/api/cron/*`).

Esquema legado de Fase 1 (`0001_init.sql`, no lo usa el código actual):
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
- Accionables vigentes (`lib/utils/actionables.ts`, `accountActionables`): última minuta + **todo lo abierto** de minutas previas, sin límite de antigüedad, y
  lo cerrado con fecha de hasta 3 minutas previas en 28 días; si la nueva minuta re-lista un punto (`keywordSimilarity`) se unen conservando el estado
  (`repeatedClosed`); solo minutas que fueron "la última" desde `CARRY_OVER_SINCE` (2026-10-31). Usado por `clientsToBoard`, `week-plan`, alertas, sync y
  borrador. `doneTicketAt` (fecha de cierre) + `ticketsUpdatedAt` en `ClientRecord`.
  UI `ActionablesList` (cuenta y Dialog del Tablero): tabs Pendientes (del último mail / última reunión /
  arrastrados) y Ejecutadas (con fecha; en la cuenta suma `executedHistory`, solo lectura, de reuniones ya no vigentes). Al tildar en la cuenta se hace
  `router.refresh()` y aparece link al borrador de seguimiento regenerado.
- Accionables de mail (`lib/utils/mail-tickets.ts`, `kind` reply/request/commitment): último mail del cliente → "Responder a X"
  (sigue abierto aunque después haya una reunión, hasta tildarlo o responder por mail). Pedidos (`requests`) y compromisos (`commitments`, `extractCommitments`, sin mails
  resumen) de cualquier mail desde 2026-10-31: `collectMailItems` (`mail-items.ts`) y `client.mailActionables` los conservan aunque el mail salga de `recentMails`; abiertos siguen
  salvo que repitan algo ya listado. Entran en `clientsToBoard`, `week-plan` y alertas; en los borradores solo van los `request` del mail de partida.
- Alertas (`lib/utils/followup-alerts.ts`, `FollowupAlerts` en Dashboard, sección Seguimiento):
  solo asignados; `client_waiting` (mail del cliente sin responder ≥1 día hábil),
  `no_progress` / `awaiting_client` (sin mails ni reuniones ≥ `settings.staleBusinessDays`
  (default 2) días hábiles con accionables abiertos).
- Borradores (`lib/utils/followup.ts`, `getDraft(kind)`), por reglas y sin placeholders en el cuerpo:
  `meeting` = resumen, hitos, decisiones (acordadas / por definir) y accionables vigentes para la próxima
  sesión (arrastrados + consultas por mail; "Ya avanzamos con" = tildados) por
  lado (`stepSide`: me/team/client/shared/unknown) con fecha objetivo (`parseStep`/`parseDue`, resuelta
  contra la fecha de la reunión); `status` parte de `latestInteraction`: último mail recibido del cliente
  o enviado por mí (no del equipo) si es posterior a la reunión; si no hay, accionables de la última reunión con lo tildado como avance. Con mail: responde en
  ese hilo y a sus participantes del lado cliente (`MailRef.recipients`, poblado en cada sync; fallback
  asistentes de la reunión). Secciones: avances del tablero desde mi último mail posterior a la reunión (o desde la reunión) / en curso nuestro con arrastrados
  marcados / conversado por mail desde la reunión (`mailTrace`: `relatedTicketIds`, sin mails resumen `isRecapMail`; nunca
  da por completado) / pedidos del cliente (solo si su mail es lo último) / pendiente del cliente / en conjunto /
  otros. El extracto del último mail va en `reviewNotes` (`lastTalkNote`). La trazabilidad excluye borradores (`-in:drafts`). Lo que requiere revisión va en `FollowupDraft.reviewNotes` (UI, nunca en el mail). En ambos tipos, si
  cambiaron tickets o llegó un mail después de la edición guardada se regenera (`regenerated`); tras `sentAt`
  se genera uno nuevo. `FollowupComposer` aplica novedades solo si no estás editando (si no, aviso). Botón Actualizar =
  `PATCH /api/clients/[id]/followup`: sincroniza esa cuenta y regenera (descarta la edición, pide confirmación si la hay). Ticket sintético follow-up `followupTicketId`.
- Saludo (`greet` en `followup.ts`): `profile.contactNames[email]` tal cual → primer nombre detectado → nombre del mail
  (`nombre.apellido@`); buzones genéricos (`GENERIC_MAILBOX`) no aportan nombre. Sin nombres: "Hola equipo de {emailName},"
  o "Hola equipo,". `emailName` va en el asunto de actualización. Cambiar `emailName`/`contactNames` regenera el borrador (`profileUpdatedAt`).
- Destinatarios (`lib/utils/followup.ts`, `FollowupDraft.cc`): mail nuevo (sin hilo) → `to` + `cc` con
  referentes y equipo Xtract que no estén ya en `to` (`newMailCc`), para que todos queden al tanto.
  Responder dentro de un hilo (hay `anchorMail`) → "Responder a todos": `cc` = De/Para/Cc de todos los
  mails de ese `threadId` en `recentMails`, salvo yo y quienes ya están en `to` (`replyAllCc`). Editable
  en `FollowupComposer` (campo Cc) y persiste en `client.followups[...].cc`; viaja a Gmail como header
  `Cc` (`buildMimeMessage`/`createThreadDraft`/`sendThreadMail`).
- Minutas (`lib/utils/gemini-notes-parser.ts`): `summary` + `milestones` (temas del Resumen) + `decisions`
  + `nextSteps`. `backfillMeetingNotes` (`gemini-mail.ts`, en `runSync` y `/api/clients/discover`) reprocesa
  por tandas de 25 las minutas con `milestones === undefined`, sin tocar `nextSteps` (los ids dependen del índice).
  `PUT|POST /api/clients/[id]/followup` `{kind, meetingId, ...}` guarda en
  `client.followups[followupKey(kind, id)]` / crea draft en Gmail (`createThreadDraft`: dentro del
  hilo elegido con Re:/In-Reply-To, o mail nuevo). Con `send: true` envía de verdad (`sendThreadMail`, solo desde el
  botón Enviar con confirmación; descarta el draft previo y refresca la actividad). El cron nunca envía. MIME
  (`buildMimeMessage`): multipart/alternative + HTML estilo Gmail + firma de la cuenta (`sendAs`). UI: tabs en `/cuentas/[id]`
  (`?borrador=status#borradores`), `FollowupComposer` (hilo, Para, editar, Copiar, Actualizar, Enviar).
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
guarda tokens en `app_state.google_tokens` (Supabase) o `.data/google-tokens.json` en modo local.
Wrappers: `lib/integrations/{gmail,calendar,drive}.ts`. Env vars nuevas:
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`.
Pendiente explícito: extracción de
accionables por LLM desde el texto de la minuta, análisis de sentimiento real, envío
automático de emails (el envío es manual, desde `/cuentas/[id]`).

## Sincronización automática (scheduler interno + cron externo opcional)
`lib/jobs/sync-job.ts` `runSync({drafts, trigger})`: minutas nuevas (`discoverGeminiMeetings(7d)` incremental +
`mergeDiscovery`) → `syncClientsActivity` (asignados + no asignados) → `computeAlerts` → si `drafts`,
borradores en Gmail (dedupe `autoFor`). Candado en `globalThis.__syncRunning` (corrida simultánea ⇒ `skipped`).
Estado en `.data/sync-status.json` (`lib/store/sync-status-store.ts`).
Scheduler: `instrumentation.ts` → `lib/jobs/scheduler.ts`, solo si `CRON_ENABLED=true` (runtime nodejs; corre
con `pnpm dev`/`pnpm start`). Tick por minuto, hora local (`TZ`): días `settings.workDays` a `CRON_DRAFTS_AT`
(08:30) sync + borradores; entre `CRON_FROM`–`CRON_TO` (9–18) cada `CRON_INTERVAL_MINUTES` (15) sync; al
iniciar o tras suspensión, recuperación si la última corrida es más vieja que el intervalo.
Endpoints: `GET /api/cron/sync` (estado, lo consulta `components/layout/SyncStatus.tsx` en el header cada 60 s y
hace `router.refresh()` si hubo corrida nueva); `POST /api/cron/sync[?drafts=1]` y
`POST /api/cron/daily-followup[?drafts=0]` (wrapper de `runSync`) con header `x-cron-secret: $CRON_SECRET` para
un cron externo opcional. `POST /api/cron/weekly-actionables` sigue stub.

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
el Dashboard también usa datos reales. `executionMinutesActual` sigue en 0 (sin fuente).
