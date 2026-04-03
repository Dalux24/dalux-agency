/**
 * server.js — Servidor Express Principal
 * ────────────────────────────────────────
 * Punto de entrada del servidor de producción.
 * Monta el router de webhooks y el dashboard.
 *
 * Iniciar servidor:  node webhook/server.js
 * Modo desarrollo:   npm run dev  (usa nodemon)
 *
 * Dalux Agency — v1.0
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

// ─── Importar módulos locales ─────────────────────────────────────────────────

const webhookRouter = require('./webhook');

// ─── Configuración ────────────────────────────────────────────────────────────

const PUERTO = parseInt(process.env.PORT) || 3000;

// ─── Crear app Express ────────────────────────────────────────────────────────

const app = express();

// Permitir peticiones desde el dashboard local (mismo host, diferente puerto)
app.use(cors());

// Parseo JSON para las rutas que lo necesitan (Meta envía JSON)
// Nota: las rutas de Twilio usan urlencoded — se parsea dentro del router
app.use(express.json());

// ─── Montar rutas ─────────────────────────────────────────────────────────────

// Webhooks de canales (Twilio, Meta WhatsApp, Instagram)
app.use('/webhook', webhookRouter);

// Dashboard operativo (sirve archivos estáticos del directorio /dashboard)
const rutaDashboard = path.join(__dirname, '../dashboard');
if (fs.existsSync(rutaDashboard)) {
  app.use('/dashboard', express.static(rutaDashboard));
  console.log(`[Server] Dashboard disponible en: http://localhost:${PUERTO}/dashboard`);
}

// ─── API interna para el dashboard ────────────────────────────────────────────

/**
 * GET /api/status — Estado general del servidor
 */
app.get('/api/status', (req, res) => {
  res.json({
    estado:    'activo',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    businessId: process.env.BUSINESS_ID || 'spa-example',
    apiKeySet: !!process.env.ANTHROPIC_API_KEY,
    twilioSet: !!process.env.TWILIO_ACCOUNT_SID,
  });
});

/**
 * GET /api/conversaciones — Últimas N conversaciones para el dashboard
 */
app.get('/api/conversaciones', (req, res) => {
  try {
    const ruta = path.join(__dirname, '../data/logs/conversations.json');
    if (!fs.existsSync(ruta)) return res.json([]);

    const todas = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const limite = parseInt(req.query.limite) || 50;

    // Retornar las más recientes primero
    res.json(todas.slice(-limite).reverse());

  } catch (error) {
    console.error('[Server] Error leyendo conversaciones:', error.message);
    res.status(500).json({ error: 'Error leyendo datos' });
  }
});

/**
 * GET /api/citas — Citas del negocio activo
 * Query params: ?fecha=YYYY-MM-DD  (opcional, filtra por fecha)
 */
app.get('/api/citas', (req, res) => {
  try {
    const ruta = path.join(__dirname, '../data/appointments.json');
    if (!fs.existsSync(ruta)) return res.json([]);

    let citas = JSON.parse(fs.readFileSync(ruta, 'utf8'));

    // Filtrar por businessId activo
    const businessId = process.env.BUSINESS_ID || 'spa-example';
    citas = citas.filter(c => c.businessId === businessId);

    // Filtrar por fecha si se especificó
    if (req.query.fecha) {
      citas = citas.filter(c => c.fecha === req.query.fecha);
    }

    // Ordenar por fecha y hora
    citas.sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));

    res.json(citas);

  } catch (error) {
    console.error('[Server] Error leyendo citas:', error.message);
    res.status(500).json({ error: 'Error leyendo datos' });
  }
});

/**
 * GET /api/escalaciones — Escalaciones pendientes para el dueño
 */
app.get('/api/escalaciones', (req, res) => {
  try {
    const ruta = path.join(__dirname, '../data/logs/escalaciones.json');
    if (!fs.existsSync(ruta)) return res.json([]);

    let escalaciones = JSON.parse(fs.readFileSync(ruta, 'utf8'));

    // Filtrar solo las no atendidas por defecto
    if (req.query.todas !== 'true') {
      escalaciones = escalaciones.filter(e => !e.atendido);
    }

    // Más recientes primero
    escalaciones.reverse();

    res.json(escalaciones);

  } catch (error) {
    console.error('[Server] Error leyendo escalaciones:', error.message);
    res.status(500).json({ error: 'Error leyendo datos' });
  }
});

/**
 * PATCH /api/escalaciones/:id/atendida — Marcar escalación como atendida
 */
app.patch('/api/escalaciones/:id/atendida', express.json(), (req, res) => {
  try {
    const ruta = path.join(__dirname, '../data/logs/escalaciones.json');
    if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'No existen escalaciones' });

    const escalaciones = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const idx = escalaciones.findIndex(e => e.id === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Escalación no encontrada' });
    }

    escalaciones[idx].atendido   = true;
    escalaciones[idx].atendidaEn = new Date().toISOString();
    fs.writeFileSync(ruta, JSON.stringify(escalaciones, null, 2));

    res.json({ ok: true, escalacion: escalaciones[idx] });

  } catch (error) {
    console.error('[Server] Error actualizando escalación:', error.message);
    res.status(500).json({ error: 'Error actualizando datos' });
  }
});

/**
 * GET /api/disponibilidad — Slots de disponibilidad (para dashboard)
 */
app.get('/api/disponibilidad', (req, res) => {
  try {
    const ruta = path.join(__dirname, '../data/availability.json');
    if (!fs.existsSync(ruta)) return res.json({ slots: [] });

    res.json(JSON.parse(fs.readFileSync(ruta, 'utf8')));

  } catch (error) {
    console.error('[Server] Error leyendo disponibilidad:', error.message);
    res.status(500).json({ error: 'Error leyendo datos' });
  }
});

/**
 * PATCH /api/disponibilidad/bloquear — Bloquear un slot manualmente
 * Body: { fecha: "YYYY-MM-DD", hora: "HH:MM", bloqueado: true|false }
 */
app.patch('/api/disponibilidad/bloquear', express.json(), (req, res) => {
  try {
    const { fecha, hora, bloqueado } = req.body;
    if (!fecha || !hora) {
      return res.status(400).json({ error: 'Se requieren fecha y hora' });
    }

    const ruta = path.join(__dirname, '../data/availability.json');
    const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));

    const slot = data.slots.find(s => s.fecha === fecha && s.hora === hora);
    if (!slot) {
      return res.status(404).json({ error: 'Slot no encontrado' });
    }

    slot.bloqueado = bloqueado !== false; // true por defecto
    fs.writeFileSync(ruta, JSON.stringify(data, null, 2));

    res.json({ ok: true, slot });

  } catch (error) {
    console.error('[Server] Error bloqueando slot:', error.message);
    res.status(500).json({ error: 'Error actualizando disponibilidad' });
  }
});

/**
 * GET /api/metricas — Métricas de los últimos 7 días para el dashboard
 */
app.get('/api/metricas', (req, res) => {
  try {
    const rutaConv = path.join(__dirname, '../data/logs/conversations.json');
    const rutaCitas = path.join(__dirname, '../data/appointments.json');

    const conversaciones = fs.existsSync(rutaConv)
      ? JSON.parse(fs.readFileSync(rutaConv, 'utf8'))
      : [];
    const citas = fs.existsSync(rutaCitas)
      ? JSON.parse(fs.readFileSync(rutaCitas, 'utf8'))
      : [];

    // Calcular ventana de 7 días
    const hace7dias = new Date();
    hace7dias.setDate(hace7dias.getDate() - 7);

    const convRecientes = conversaciones.filter(
      c => new Date(c.timestamp) >= hace7dias
    );
    const citasRecientes = citas.filter(
      c => new Date(c.creadaEn) >= hace7dias
    );

    const totalMensajes  = convRecientes.length;
    const totalEscaladas = convRecientes.filter(c => c.escalado).length;
    const totalCitas     = citasRecientes.length;

    res.json({
      periodo:          '7 días',
      totalMensajes,
      totalCitas,
      totalEscaladas,
      tasaEscalacion:   totalMensajes > 0
        ? Math.round((totalEscaladas / totalMensajes) * 100) + '%'
        : '0%',
      // Desglose por intención
      intenciones: convRecientes.reduce((acc, c) => {
        acc[c.intencion] = (acc[c.intencion] || 0) + 1;
        return acc;
      }, {}),
    });

  } catch (error) {
    console.error('[Server] Error calculando métricas:', error.message);
    res.status(500).json({ error: 'Error calculando métricas' });
  }
});

// ─── Manejo de rutas no encontradas ──────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    rutas_disponibles: [
      'POST /webhook/twilio',
      'GET|POST /webhook/meta',
      'GET /api/status',
      'GET /api/conversaciones',
      'GET /api/citas',
      'GET /api/escalaciones',
      'GET /api/disponibilidad',
      'GET /api/metricas',
      'GET /dashboard',
    ],
  });
});

// ─── Endpoint de diagnóstico temporal ────────────────────────────────────────
app.post('/api/test-agente', express.json(), async (req, res) => {
  try {
    const { AgentCore }          = require('../agent/agent-core');
    const { loadBusinessConfig } = require('../config/config-loader');
    const config    = loadBusinessConfig(process.env.BUSINESS_ID || 'spa-example');
    const agente    = new AgentCore(config);
    const resultado = await agente.procesarMensaje('test_debug', req.body?.mensaje || 'Hola', 'whatsapp');
    res.json({ ok: true, resultado });
  } catch (e) {
    res.json({ ok: false, error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

// Demo público — al final para no interceptar /api/* ni /webhook ni /dashboard
const demoRouter = require('../demo/demo-server');
app.use('/', demoRouter);

// ─── Manejo global de errores ─────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Server] Error no manejado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────

app.listen(PUERTO, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       🤖 Dalux Agency — Receptionist IA         ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Servidor activo en: http://localhost:${PUERTO}       ║`);
  console.log(`║  Negocio:            ${(process.env.BUSINESS_ID || 'spa-example').padEnd(26)} ║`);
  console.log('║                                                  ║');
  console.log('║  Webhooks:                                       ║');
  console.log(`║    Twilio:    POST /webhook/twilio               ║`);
  console.log(`║    Meta WA:   POST /webhook/meta                 ║`);
  console.log(`║    Instagram: POST /webhook/meta                 ║`);
  console.log('║                                                  ║');
  console.log(`║  Dashboard: http://localhost:${PUERTO}/dashboard      ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});

module.exports = app;
