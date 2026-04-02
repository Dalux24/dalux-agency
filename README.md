# 🤖 Dalux Agency — Agente Recepcionista IA

Sistema completo de agente recepcionista IA para WhatsApp e Instagram.  
Atiende clientes, responde preguntas y agenda citas 24/7.

**Dalux Agency** · Guadalajara, México · [dalux-agency.netlify.app](https://dalux-agency.netlify.app)

---

## Requisitos

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Cuenta Anthropic** — [console.anthropic.com](https://console.anthropic.com) (para la API key de Claude)
- **Cuenta Twilio** — [twilio.com](https://www.twilio.com) (para la demo de WhatsApp Sandbox)

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de variables de entorno
cp .env.example .env

# 3. Editar .env con tus credenciales reales
#    (mínimo requerido para el demo: ANTHROPIC_API_KEY)
```

---

## Modo Demo (sin WhatsApp real)

La forma más rápida de probar el sistema y mostrarlo a clientes:

```bash
node demo/demo-server.js
```

Se abre automáticamente en el navegador en `http://localhost:3001`.  
Usa la configuración de **Spa Zenith GDL** precargada.  
No requiere Twilio ni Meta — funciona 100% local.

---

## Servidor de producción

```bash
# Modo normal
npm start

# Modo desarrollo (reinicia automáticamente con nodemon)
npm run dev
```

El servidor corre en `http://localhost:3000` (configurable con `PORT` en `.env`).

### Endpoints disponibles

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/webhook/twilio` | WhatsApp Sandbox (Twilio) |
| `GET`  | `/webhook/meta` | Verificación de webhook Meta |
| `POST` | `/webhook/meta` | WhatsApp Cloud API + Instagram |
| `GET`  | `/dashboard` | Dashboard operativo |
| `GET`  | `/api/status` | Estado del servidor |
| `GET`  | `/api/metricas` | Métricas 7 días |
| `GET`  | `/api/citas` | Citas del negocio activo |
| `GET`  | `/api/escalaciones` | Escalaciones pendientes |
| `GET`  | `/api/disponibilidad` | Slots disponibles |

---

## Configurar Twilio WhatsApp Sandbox

1. Crear cuenta en [twilio.com](https://www.twilio.com)
2. Ir a **Console → Messaging → Try it out → Send a WhatsApp message**
3. Escanear el QR con tu celular para unirte al Sandbox
4. En **Sandbox Settings**, configurar el Webhook URL:
   ```
   https://TU-DOMINIO.ngrok.io/webhook/twilio
   ```
   > Para pruebas locales usa [ngrok](https://ngrok.com): `ngrok http 3000`
5. Copiar **Account SID** y **Auth Token** al `.env`

Variables de entorno necesarias:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

---

## Agregar un nuevo cliente

Onboardear un negocio nuevo toma menos de 5 minutos — **sin tocar código**:

1. Copiar la plantilla:
   ```bash
   cp config/business-template.json config/businesses/nombre-negocio.json
   ```

2. Editar `config/businesses/nombre-negocio.json` con los datos reales:
   - Nombre, dirección, teléfono
   - Servicios y precios
   - Horarios de atención
   - Tono del agente (`formal` | `amigable` | `profesional`)
   - Tipo de agenda (`json_local` o `google_calendar`)

3. Cambiar `BUSINESS_ID` en `.env`:
   ```env
   BUSINESS_ID=nombre-negocio
   ```

4. Reiniciar el servidor: `npm run dev`

---

## Configurar Google Calendar (Ruta B)

Para negocios que quieren ver las citas directo en su Google Calendar:

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Crear proyecto → Habilitar **Google Calendar API**
3. Crear credenciales OAuth 2.0 (tipo "Desktop app")
4. Descargar `credentials.json`
5. Correr el script de autorización (próximamente) para obtener los tokens
6. Agregar al `.env`:
   ```env
   GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
   GOOGLE_ACCESS_TOKEN_NOMBRE_NEGOCIO=ya29.xxxxx
   GOOGLE_REFRESH_TOKEN_NOMBRE_NEGOCIO=1//xxxxx
   ```
7. En el JSON del negocio: `"agenda": { "tipo": "google_calendar" }`

> El nombre de la variable es el `id` del negocio en MAYÚSCULAS con guiones reemplazados por `_`.  
> Ej: `dentista-guerrero` → `GOOGLE_ACCESS_TOKEN_DENTISTA_GUERRERO`

---

## Ruta de migración: Twilio Sandbox → WhatsApp Cloud API oficial

Cuando el cliente quiera pasar a producción con número propio:

### Paso 1 — Crear App en Meta
1. [developers.facebook.com](https://developers.facebook.com) → Crear App → Tipo: Business
2. Agregar producto **WhatsApp**
3. Obtener **Phone Number ID** y **Token de acceso permanente**

### Paso 2 — Registrar número de teléfono
1. En Meta for Developers → WhatsApp → Phone Numbers
2. Agregar y verificar el número del negocio (requiere línea con capacidad de recibir SMS)
3. Enviar solicitud de aprobación de cuenta Business (1-3 días hábiles)

### Paso 3 — Configurar webhook
1. En la App de Meta → WhatsApp → Configuration
2. Webhook URL: `https://tudominio.com/webhook/meta`
3. Verify Token: el valor de `META_VERIFY_TOKEN` en tu `.env`
4. Suscribir al evento: `messages`

### Paso 4 — Actualizar `.env`
```env
META_VERIFY_TOKEN=tu_token_personalizado
META_WHATSAPP_TOKEN=EAAxxxxx
META_PHONE_NUMBER_ID=1234567890
```

### Paso 5 — Sin cambios en el código
El `webhook.js` ya maneja ambos canales.  
Solo cambia las variables de entorno y reinicia el servidor.

---

## Estructura del proyecto

```
dalux-agency/
├── agent/
│   ├── agent-core.js          # Cerebro del agente (orquesta todo)
│   ├── context-manager.js     # Historial de conversación por usuario
│   ├── intent-detector.js     # Detección de intención sin LLM
│   └── calendar-integration.js# Google Calendar (Ruta B)
├── config/
│   ├── business-template.json # Plantilla para nuevos clientes
│   ├── config-loader.js       # loadBusinessConfig(id)
│   └── businesses/
│       ├── dentista-example.json   # Google Calendar
│       ├── veterinaria-example.json# JSON local
│       └── spa-example.json        # JSON local (usado en el demo)
├── data/
│   ├── appointments.json      # Citas agendadas
│   ├── availability.json      # Slots disponibles
│   └── logs/
│       ├── conversations.json # Log de todas las conversaciones
│       └── escalaciones.json  # Flags para el dueño del negocio
├── webhook/
│   ├── webhook.js             # Router: Twilio + Meta WA + Instagram
│   └── server.js              # Express + API interna para el dashboard
├── dashboard/
│   ├── index.html             # Dashboard operativo
│   ├── dashboard.js           # Lógica del dashboard
│   └── styles.css             # Estilos (paleta Dalux Agency)
├── demo/
│   ├── demo-server.js         # Servidor demo (node demo/demo-server.js)
│   └── demo-chat.html         # Chat estilo WhatsApp para prospectos
├── .env.example               # Plantilla de variables de entorno
├── package.json
└── README.md
```

---

## Variables de entorno mínimas para iniciar

```env
ANTHROPIC_API_KEY=sk-ant-xxxxx   # Requerido siempre
BUSINESS_ID=spa-example           # ID del negocio activo
PORT=3000                         # Puerto del servidor (default: 3000)
```

---

## Soporte

**Dalux Agency** — Guadalajara, México  
[dalux-agency.netlify.app](https://dalux-agency.netlify.app)
