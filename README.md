# Following Dashboard — Metodología de Seguimiento Xtract

Dashboard personal (un solo usuario, sin login, self-hosted) para hacer seguimiento de las
cuentas de clientes de Xtract: qué se acordó en cada reunión, qué falta hacer, quién está
esperando respuesta y cuánto tiempo real queda en la semana para cerrarlo todo.

La fuente de verdad son las **minutas de Gemini Notes** (Google Meet) que llegan por mail, más
la actividad de **Gmail** y **Google Calendar**. A partir de eso el sistema arma automáticamente
la lista de clientes, sus accionables, alertas de seguimiento y borradores de correo.

---

## 1. Cómo funciona (flujo general)

```
Gemini Notes (mail + Doc)  ─┐
Google Calendar (eventos)  ─┼─►  Descubrimiento de clientes  ─►  Validación manual (/clientes)
Gmail (hilos)              ─┘                                         │
                                                                       ▼
                                             Cliente asignado (.data/clients.json)
                                                                       │
             ┌─────────────────────────┬──────────────────────────────┼─────────────────────────┐
             ▼                         ▼                              ▼                         ▼
     Accionables vigentes     Actividad de mails/reuniones     Planificador semanal     Borradores de seguimiento
     (minutas + mails)        (sync-activity)                  (capacidad vs pendientes) (Gmail drafts, nunca envía)
             │                         │
             └──────────► Alertas de seguimiento (cliente esperando / sin avance)
```

1. **Descubrir**: se escanean los mails de `gemini-notes@google.com` de los últimos 60 días.
   Cada minuta se cruza con su evento de Calendar para obtener los asistentes; los asistentes
   externos se agrupan por dominio y forman un *cliente candidato*. El texto del Doc se parsea
   por reglas (secciones *Resumen* y *Próximos pasos*), sin LLM.
2. **Validar**: en `/clientes` se revisa cada candidato y se marca como *Asignado*,
   *No asignado* o *Ignorado* (y se le puede corregir el nombre).
3. **Seguir**: los clientes asignados alimentan el Dashboard, el Tablero y el detalle de cuenta.
4. **Sincronizar actividad**: se leen los últimos mails reales con cada cliente (descartando
   invitaciones, auto-respuestas y minutas) y la última reunión de Calendar.
5. **Actuar**: el sistema propone accionables, alerta lo que está quieto y prepara borradores de
   correo en Gmail para que solo haya que revisarlos y enviarlos.

---

## 2. Secciones de la app

### `/` Dashboard
De arriba hacia abajo:
- **Números** (`KeyNumbers`): métricas clave de la cartera.
- **Capacidad** (`WeekPlanner`): planificador de la semana cuya meta es cerrar todos los
  pendientes antes del viernes.
  - Toma las reuniones de Calendar y el almuerzo como tiempo ocupado.
  - Estima el tiempo de los accionables pendientes (por defecto 0,5 h c/u).
  - Los reparte por urgencia: primero en horario normal (10:00–17:30) y luego en horario
    flexible (9:00–18:00).
  - Da un veredicto: **core** (cabe en horario normal), **flex** (requiere extender) o
    **déficit** (no alcanza).
  - Muestra cada día con su timeline, huecos libres y toggle *Esta semana / Próxima*.
  - El engranaje ⚙ abre la configuración de jornada.
- **Seguimiento** (`FollowupAlerts`): alertas de cuentas que requieren atención.
- **Cuentas** (`AccountsSplitView`): listado con buscador por nombre, dominio o ERP.

### `/cuentas/[id]` Detalle de cuenta
- Última reunión con duración, % de engagement y accionables tildables.
- Participantes clasificados: owner Xtract, referentes del cliente, equipo Xtract y otros
  (se puede marcar referentes a mano con ⭐).
- Historial de reuniones, actividad de mails y lista de accionables por semana.
- Perfil editable: nombre, nombre en correos, ERP, owner y notas.
- Borradores de seguimiento (pestañas *Reunión* / *Actualización de avance*).
- Accesos rápidos al último hilo en Gmail y a la tarjeta en el Tablero.

### `/tablero` Tablero de seguimiento
Kanban de cuentas asignadas con 4 columnas:
**Tareas Generadas → Tareas en Curso → Tareas con Prioridad → Tareas Finalizadas**.
Cada tarjeta muestra la cuenta, la fecha de la última reunión y el % de engagement. Al
hacer clic se abren los accionables. El drag-and-drop es propio (sin librerías), funciona
con mouse y touch, y el cambio de columna se guarda.

### `/clientes` Validación de clientes
Botón para escanear Gemini Notes, pestañas *Por validar / Asignados / No asignados /
Ignorados*, nombre editable y lista de reuniones a las que no se les detectó cliente.

### `/conexiones` Integraciones
Estado en vivo de Gmail, Calendar, Gemini Notes, Notion y Xtract, con los botones para
conectar cada una.

---

## 3. Conceptos clave

| Concepto | Qué es |
|---|---|
| **Accionable** | Tarea que sale de los *Próximos pasos* de una minuta o de un mail del cliente. Los propios se identifican por el alias configurado. |
| **Accionables vigentes** | Los de la última minuta + los abiertos de hasta 3 minutas previas (28 días), sin duplicar lo que la nueva minuta repite. |
| **Accionables de mail** | Si el cliente escribió después de la última reunión: "Responder a X" + uno por cada pedido detectado. |
| **Engagement %** | Proporción de accionables cerrados. Se calcula a partir de los tickets y no se guarda como dato propio. |
| **Alertas** | `client_waiting`: el cliente espera respuesta ≥1 día hábil. `no_progress` / `awaiting_client`: sin mails ni reuniones durante ≥2 días hábiles con accionables abiertos. |
| **Borradores** | `meeting` (resumen + próximos pasos) y `status` (avance de la semana). Se crean como draft en Gmail, dentro del hilo elegido. **Nunca se envían solos.** |
| **Prioridad** | Matriz 2×2 tiempo/dificultad: quick win, proyecto mayor, relleno, tarea ingrata. |

---

## 4. Sincronización automática

La app se actualiza sola con un programador interno (no hace falta Vercel Cron ni crontab). Se activa con
`CRON_ENABLED=true` en `.env.local` y corre mientras el servidor esté levantado (`pnpm dev` o `pnpm start`).

| Cuándo (días hábiles) | Qué hace |
|---|---|
| Cada 15 min entre 9 y 18 h | Busca minutas nuevas de Gemini (reuniones y próximos accionables), actualiza los mails enviados y recibidos con cualquier persona del cliente y recalcula alertas. |
| 8:30 | Lo mismo y además crea en Gmail 1 borrador de actualización por cuenta alertada (nunca se envían solos). |
| Al iniciar la app o al despertar el equipo | Si la última sincronización quedó vieja, corre una enseguida. |

En el encabezado se ve "hace X min" con la última sincronización. Cuando entra una nueva, la pantalla se
refresca sola. El horario se ajusta con `CRON_INTERVAL_MINUTES`, `CRON_FROM`, `CRON_TO` y `CRON_DRAFTS_AT`.

**En un servidor/VPS:** `pnpm build && pnpm start` con pm2 o systemd, `CRON_ENABLED=true`, `TZ=America/Santiago`
(o la zona que corresponda), redirect URIs de Google/Notion apuntando al dominio, y copiar la carpeta `.data/`.

**Cron externo (opcional):** `POST /api/cron/sync` (`?drafts=1` para borradores) o `POST /api/cron/daily-followup`
con el header `x-cron-secret: $CRON_SECRET`.

---

## 5. Stack y estructura

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind v4 + shadcn/ui · pnpm · Supabase
(preparado, todavía sin usar) · Google APIs (Gmail, Calendar, Drive) · Notion API.

```
app/                 Páginas (/, /cuentas, /tablero, /clientes, /conexiones) y rutas API
  api/auth/          OAuth de Google y Notion
  api/clients/       Descubrimiento, edición, sincronización de actividad y borradores
  api/cron/          Endpoints para el cron externo
  api/integrations/  Estado de cada integración
components/          UI por sección (dashboard, cuentas, tablero, clientes, layout, ui)
lib/integrations/    Clientes de Gmail, Calendar, Drive, Notion y lectura de Gemini Notes
lib/store/           Persistencia en archivos locales (.data/*.json)
lib/utils/           Lógica de negocio: accionables, planificador, alertas, borradores, parser
lib/mock/            Datos de prueba de la Fase 1
supabase/migrations/ Esquema SQL para cuando exista el proyecto Supabase
types/               Tipos compartidos
```

**Persistencia actual:** archivos locales en `.data/` (no se suben al repo):
`google-tokens.json`, `notion-tokens.json`, `clients.json` y `settings.json`.

---

## 6. Puesta en marcha

```bash
pnpm install
cp .env.local.example .env.local   # completar las variables
pnpm dev                           # http://localhost:3000
```

Variables principales (ver `.env.local.example`):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: OAuth de Google.
- `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, `NOTION_REDIRECT_URI` y los nombres
  de las propiedades de la base de cuentas.
- `CRON_SECRET`: protege los endpoints de cron.
- `NEXT_PUBLIC_SUPABASE_*`: para cuando se cree el proyecto Supabase.

Después ir a `/conexiones`, conectar Google, y en `/clientes` ejecutar el primer escaneo.

Otros comandos: `pnpm build` · `pnpm lint`.

---

## 7. Estado y pendientes

- ✅ Fase 1: arquitectura y UI completas.
- 🔄 Fase 1.5: Gmail, Calendar y Gemini Notes conectados con OAuth real. Los datos viven en
  archivos locales.
- ⏳ Pendientes:
  - Migrar la persistencia a Supabase.
  - Extraer los accionables con un LLM.
  - Análisis de sentimiento real.
  - Envío real de correos (hoy solo se crean borradores).
  - Integración Xtract (facturas).
  - Medir el tiempo real de ejecución.

> Documentación técnica detallada para desarrollo: [`CLAUDE.md`](./CLAUDE.md).
