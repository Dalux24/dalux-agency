# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dalux Agency** is a micro-agency (solopreneur) that builds and sells AI Receptionist Agents for local businesses in Guadalajara, Mexico. The product delivers automated customer-facing agents via **WhatsApp and Instagram DMs** that handle inquiries, bookings, and FAQs on behalf of the business.

**Target verticals:** dentistas, veterinarias, spas, barberías, consultorios médicos, yoga studios.

**Operating languages:** Mexican Spanish (primary — client-facing agent responses, UI copy, code comments) and English (internal documentation, README, code variable names). Default to Spanish for anything the end-user sees; English is acceptable for developer-facing content.

## Commands

```bash
npm install                   # instalar dependencias (primera vez)
npm start                     # servidor producción en puerto 3000
npm run dev                   # desarrollo con nodemon (reinicia automático)
node demo/demo-server.js      # demo para prospectos — puerto 3001, abre navegador solo
```

El servidor principal expone webhooks en `/webhook/twilio` y `/webhook/meta`, y una API interna en `/api/*` para el dashboard.

## Architecture

El sistema tiene 5 módulos independientes:

### 1. Agent (`/agent/`)
- **`agent-core.js`** — punto de entrada. `new AgentCore(config)` + `procesarMensaje(userId, mensaje, canal)`. Orquesta contexto, intención, Claude API y agendamiento.
- **`context-manager.js`** — historial de 10 mensajes por userId en memoria. Limpieza automática cada 24h. Migrar a Redis/Supabase en producción.
- **`intent-detector.js`** — detección de intención por palabras clave sin gastar tokens: `agendar | precio | ubicacion | horarios | cancelar | queja | humano | saludo | otro`.
- **`calendar-integration.js`** — Google Calendar (Ruta B). Solo se inicializa si `config.agenda.tipo === 'google_calendar'`.

El flujo de agendamiento es una **máquina de 4 pasos** con estado en ContextManager: `seleccion_servicio → seleccion_fecha → confirmacion_nombre → guardar_cita`. La ruta A (JSON) hace fallback automático si la Ruta B (Google Calendar) falla.

### 2. Webhook (`/webhook/`)
- **`webhook.js`** — Router Express. `POST /webhook/twilio` (urlencoded), `GET|POST /webhook/meta` (JSON). Meta requiere `res.status(200).send('EVENT_RECEIVED')` inmediato antes de procesar.
- **`server.js`** — Express app + 8 endpoints `/api/*` para el dashboard. `PATCH /api/disponibilidad/bloquear` y `PATCH /api/escalaciones/:id/atendida` modifican los JSONs locales.

### 3. Config (`/config/`)
- **`config-loader.js`** — `loadBusinessConfig(businessId)` lee `config/businesses/{id}.json`. Sanitiza path traversal. Valida campos requeridos con mensajes descriptivos.
- Onboardear cliente nuevo = crear `config/businesses/nuevo-cliente.json` + cambiar `BUSINESS_ID` en `.env`. Sin tocar código.
- El campo `negocio.id` dentro del JSON **debe coincidir** con el nombre del archivo (sin `.json`). Esto causó un bug en el demo (spa-example.json tenía `id: "spa-zenith"`).

### 4. Dashboard (`/dashboard/`)
- HTML/CSS/JS vanilla. Se sirve como estático desde `server.js` en `/dashboard`.
- Auto-refresh cada 30s. Fuentes: **Outfit** + **Instrument Serif** (mismas que dalux-agency.netlify.app).
- Paleta: navy `#1e2340` | azul `#4f5ae8` | coral `#e85f5f` | verde `#00b86e`.

### 5. Demo (`/demo/`)
- `demo-server.js` corre en puerto **3001**. Primero intenta Claude API real; si falla (sin créditos, error), cae automáticamente al **modo simulado** con respuestas pregrabadas de Luna.
- El modo simulado mantiene estado conversacional por `sessionId` en `sesionesSimuladas` (Map en memoria) para que el flujo de agendamiento funcione completo sin API.
- El `businessId` en `demo-server.js` debe ser `'spa-example'` (no `'spa-zenith'`).

## Data Layer

Todos los datos son JSON locales en `/data/`. Estructura lista para migrar a Supabase:

| Archivo | Contenido |
|---|---|
| `data/appointments.json` | Citas confirmadas. Campo `businessId` para multi-cliente. |
| `data/availability.json` | Slots con `{ fecha, fechaTexto, hora, bloqueado }`. Actualizar manualmente cuando pasen las fechas. |
| `data/logs/conversations.json` | Log de interacciones. Se trunca a 1000 entradas. |
| `data/logs/escalaciones.json` | Flags para el dueño. Campo `atendido: false` hasta marcarlos desde el dashboard. |

## Integrations

| Integración | Estado | Notas |
|---|---|---|
| **Claude API (Haiku)** | ✅ Configurado | Modelo: `claude-haiku-4-5-20251001`. API key en `.env`. |
| **Twilio WhatsApp Sandbox** | ⏳ Pendiente | Necesita cuenta Twilio + ngrok para webhooks locales. |
| **WhatsApp Cloud API (Meta)** | ⏳ Pendiente producción | Código listo. Ver README sección "Ruta de migración". |
| **Instagram Messaging API** | ⏳ Pendiente | Mismo endpoint `/webhook/meta` que WhatsApp Cloud API. |
| **Google Calendar** | ⏳ Pendiente por cliente | Solo para negocios con `agenda.tipo: "google_calendar"`. Tokens por negocio en `.env`. |
| **Make.com** | ⏳ Opcional | `MAKE_WEBHOOK_URL` en `.env` para orquestación adicional. |

## Gotchas

- **`negocio.id` debe coincidir con el nombre del archivo** — `config/businesses/spa-example.json` debe tener `"id": "spa-example"`, no `"spa-zenith"`. El config-loader valida por nombre de archivo, no por el campo `id`.
- **Claude API ≠ Claude PRO** — La suscripción claude.ai no da acceso a la API. Son cuentas de billing separadas en console.anthropic.com.
- **`/dev/stdin` no existe en Windows** — Para parsear JSON de curl en Windows usar `curl ... > tmp.json && node -e "console.log(require('./tmp.json'))"` en lugar de pipes con `node -e "readFileSync('/dev/stdin')"`.
- **Meta webhook requiere ACK inmediato** — `res.status(200).send('EVENT_RECEIVED')` debe ir antes del procesamiento asíncrono, si no Meta reintenta.
- **`open` package es ESM** — Usar `const open = (await import('open')).default` en lugar de `require('open')`.
- **Disponibilidad estática** — `data/availability.json` tiene fechas hardcodeadas. Actualizar manualmente o crear un script generador cuando pasen las fechas.
