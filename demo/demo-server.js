/**
 * demo-server.js — Servidor del Modo Demo
 * ─────────────────────────────────────────
 * Levanta un servidor Express en el puerto 3001,
 * sirve la interfaz de chat estilo WhatsApp y conecta
 * el chat con el AgentCore real (Claude API).
 *
 * MODO SIMULADO: Si la API de Claude falla (sin créditos, sin internet,
 * etc.), activa automáticamente respuestas pregrabadas de Luna para
 * mostrar el demo completo sin necesidad de API key activa.
 *
 * Cómo usar:
 *   node demo/demo-server.js
 *
 * Se abre automáticamente en el navegador.
 * Dalux Agency — v1.0
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const path    = require('path');

const { AgentCore }          = require('../agent/agent-core');
const { loadBusinessConfig }  = require('../config/config-loader');

// ─── Configuración ────────────────────────────────────────────────────────────

const PUERTO_DEMO      = parseInt(process.env.PORT) || 3001;
const ES_PRODUCCION    = !!process.env.PORT;
const URL_DEMO         = `http://localhost:${PUERTO_DEMO}`;
const BUSINESS_ID_DEMO = 'spa-example';

// ─── Inicializar agente ───────────────────────────────────────────────────────

let agente;
let configNegocio;
try {
  configNegocio = loadBusinessConfig(BUSINESS_ID_DEMO);
  agente = new AgentCore(configNegocio);
  console.log(`[Demo] Agente IA listo: "${configNegocio.negocio.nombre}" — ${configNegocio.agente.nombre}`);
} catch (error) {
  console.error('[Demo] Error cargando config:', error.message);
  process.exit(1);
}

// ─── Modo Simulado — Respuestas pregrabadas de Luna ──────────────────────────
//
// Se activa automáticamente cuando la API de Claude no está disponible.
// Cubre el flujo completo: saludo → consulta → agendamiento → confirmación.
// Estado conversacional por sessionId para que el booking fluya paso a paso.

// Sesiones del modo simulado: sessionId → { paso, servicio, slot }
const sesionesSimuladas = new Map();

const SERVICIOS_DEMO = configNegocio?.servicios || [
  { nombre: 'Masaje relajante 60 min', precio: 650, duracion: 60 },
  { nombre: 'Masaje relajante 90 min', precio: 900, duracion: 90 },
  { nombre: 'Masaje descontracturante', precio: 750, duracion: 60 },
  { nombre: 'Facial hidratante', precio: 700, duracion: 60 },
  { nombre: 'Exfoliación corporal', precio: 600, duracion: 45 },
];

/**
 * Genera slots de disponibilidad demo para los próximos 4 días hábiles.
 * Se recalcula cada vez que arranca el servidor, así nunca quedan fechas vencidas.
 */
function generarSlotsDemo() {
  const DIAS   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MESES  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const HORAS  = ['09:00','10:00','11:00','12:00','15:00','16:00'];
  const slots  = [];
  const hoy    = new Date();
  let offset   = 1;

  while (slots.length < 6) {
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + offset++);
    if (fecha.getDay() === 0) continue; // sin domingos
    const texto = `${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
    slots.push({ fecha: texto, hora: HORAS[slots.length % 2 === 0 ? 1 : 4] });
  }
  return slots;
}

const SLOTS_DEMO = generarSlotsDemo();

/**
 * Genera la respuesta simulada de Luna según el mensaje y el estado actual.
 *
 * @param {string} mensaje   - Mensaje del usuario
 * @param {string} sessionId - ID de la sesión
 * @returns {{ respuesta: string, intencion: string, citaCreada: boolean }}
 */
function respuestaSimulada(mensaje, sessionId) {
  const msg    = mensaje.toLowerCase().trim();
  const sesion = sesionesSimuladas.get(sessionId) || { paso: 'inicio' };

  // ── Flujo de agendamiento activo ──────────────────────────────────────────
  if (sesion.paso === 'esperando_servicio') {
    const num = parseInt(msg);
    const servicio = (!isNaN(num) && num >= 1 && num <= SERVICIOS_DEMO.length)
      ? SERVICIOS_DEMO[num - 1]
      : SERVICIOS_DEMO.find(s => msg.includes(s.nombre.toLowerCase().split(' ')[0]));

    if (servicio) {
      sesionesSimuladas.set(sessionId, { paso: 'esperando_slot', servicio });
      const slots = SLOTS_DEMO.map((s, i) => `${i + 1}. ${s.fecha} a las ${s.hora}`).join('\n');
      return {
        respuesta: `Excelente, elegiste: *${servicio.nombre}* ✅\n\nHorarios disponibles:\n\n${slots}\n\n¿Cuál te funciona? Escribe el número.`,
        intencion: 'agendar',
        citaCreada: false,
      };
    }
    return {
      respuesta: `No encontré ese servicio. Por favor escribe el número de la lista 😊`,
      intencion: 'agendar',
      citaCreada: false,
    };
  }

  if (sesion.paso === 'esperando_slot') {
    const num = parseInt(msg);
    const slot = (!isNaN(num) && num >= 1 && num <= SLOTS_DEMO.length)
      ? SLOTS_DEMO[num - 1]
      : null;

    if (slot) {
      sesionesSimuladas.set(sessionId, { ...sesion, paso: 'esperando_nombre', slot });
      return {
        respuesta: `Perfecto! Horario seleccionado: *${slot.fecha} a las ${slot.hora}* 🗓\n\n¿Me das tu nombre completo para registrar la cita?`,
        intencion: 'agendar',
        citaCreada: false,
      };
    }
    return {
      respuesta: `Por favor escribe el número del horario que prefieres (del 1 al ${SLOTS_DEMO.length}).`,
      intencion: 'agendar',
      citaCreada: false,
    };
  }

  if (sesion.paso === 'esperando_nombre') {
    const nombre = mensaje.trim();
    const { servicio, slot } = sesion;
    sesionesSimuladas.set(sessionId, { paso: 'completado' });
    return {
      respuesta: `¡Listo, ${nombre}! Tu cita está confirmada ✅\n\n📅 *${slot.fecha}*\n⏰ *${slot.hora}*\n💆 *${servicio.nombre}* — $${servicio.precio} MXN\n\nTe esperamos en Spa Zenith GDL 🌿\nSi necesitas cancelar, contáctanos con al menos 24 horas de anticipación.`,
      intencion: 'agendar',
      citaCreada: true,
    };
  }

  // ── Respuestas generales por intención detectada ──────────────────────────

  // Saludo
  if (/^(hola|buenos|buenas|hey|buen día|saludos|hi)/i.test(msg)) {
    return {
      respuesta: `¡Hola! Bienvenid@ a Spa Zenith GDL 🌿 Soy Luna, tu asistente virtual.\n\n¿En qué te puedo ayudar hoy? Puedo darte información sobre nuestros servicios, precios, horarios o ayudarte a agendar una cita 😊`,
      intencion: 'saludo',
      citaCreada: false,
    };
  }

  // Precio
  if (/precio|costo|cuánto|cuanto|cobran|tarifa|vale/i.test(msg)) {
    const lista = SERVICIOS_DEMO.map(s => `• ${s.nombre}: *$${s.precio} MXN* (${s.duracion} min)`).join('\n');
    return {
      respuesta: `¡Claro! Estos son nuestros servicios y precios 💆\n\n${lista}\n\n¿Te interesa alguno en particular o quieres agendar una cita?`,
      intencion: 'precio',
      citaCreada: false,
    };
  }

  // Agendar
  if (/agendar|cita|reservar|quiero|apartar|disponib/i.test(msg)) {
    const lista = SERVICIOS_DEMO.map((s, i) => `${i + 1}. ${s.nombre} — $${s.precio} MXN (${s.duracion} min)`).join('\n');
    sesionesSimuladas.set(sessionId, { paso: 'esperando_servicio' });
    return {
      respuesta: `¡Con gusto te ayudo a agendar! 📅\n\n¿Qué servicio te interesa?\n\n${lista}\n\nEscribe el número o el nombre del servicio.`,
      intencion: 'agendar',
      citaCreada: false,
    };
  }

  // Horarios
  if (/horario|hora|abren|cierran|días|cuando/i.test(msg)) {
    return {
      respuesta: `Nuestros horarios de atención son:\n\n🗓 Lunes a Viernes: 10:00 – 20:00\n🗓 Sábado: 09:00 – 21:00\n🗓 Domingo: 10:00 – 18:00\n\n¿Quieres agendar una cita? 😊`,
      intencion: 'horarios',
      citaCreada: false,
    };
  }

  // Ubicación
  if (/dónde|donde|dirección|direccion|ubicación|como llego|maps/i.test(msg)) {
    return {
      respuesta: `Estamos ubicados en:\n\n📍 *Av. López Mateos Norte 1440*\nCol. Italia Providencia, Guadalajara, Jalisco\n\nTenemos estacionamiento disponible. ¿Necesitas agendar una cita? 🌿`,
      intencion: 'ubicacion',
      citaCreada: false,
    };
  }

  // Cancelar
  if (/cancelar|cancela|ya no|reagendar/i.test(msg)) {
    return {
      respuesta: `Entendemos perfectamente 🙏 Para cancelar o reagendar tu cita, comunícate con al menos 24 horas de anticipación.\n\nLlámanos al *+52 33 3641 7730* y con gusto te ayudamos.`,
      intencion: 'cancelar',
      citaCreada: false,
    };
  }

  // Gracias / despedida
  if (/gracia|gracias|perfecto|excelente|hasta|bye|adios/i.test(msg)) {
    return {
      respuesta: `¡Fue un placer atenderte! 🌿 Te esperamos en Spa Zenith GDL. Que tengas un excelente día 😊`,
      intencion: 'saludo',
      citaCreada: false,
    };
  }

  // Respuesta genérica
  return {
    respuesta: `Gracias por escribirnos 😊 Puedo ayudarte con información sobre nuestros *servicios y precios*, *horarios*, *ubicación* o *agendar una cita*. ¿Qué necesitas?`,
    intencion: 'otro',
    citaCreada: false,
  };
}

// ─── App Express ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Servir demo-chat.html en la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'demo-chat.html'));
});

/**
 * POST /chat — Procesa un mensaje del visitante demo
 * Intenta primero con Claude API real; si falla, usa modo simulado.
 *
 * Body:     { mensaje: string, sessionId: string }
 * Response: { respuesta: string, intencion: string, citaCreada: boolean, modo: 'real'|'simulado' }
 */
app.post('/chat', async (req, res) => {
  const { mensaje, sessionId } = req.body;

  if (!mensaje || typeof mensaje !== 'string') {
    return res.status(400).json({ error: 'El campo "mensaje" es requerido' });
  }

  const userId = `demo_${(sessionId || 'default').slice(0, 20)}`;

  // ── Intentar con Claude API real ───────────────────────────────────────────
  try {
    const resultado = await agente.procesarMensaje(userId, mensaje.trim(), 'demo');

    // Si el agente devolvió un error técnico, caer al modo simulado
    if (resultado.intencion === 'error') {
      throw new Error('Agente reportó error interno');
    }

    return res.json({
      respuesta:  resultado.respuesta,
      intencion:  resultado.intencion,
      escalado:   resultado.escalado,
      citaCreada: resultado.citaCreada,
      modo:       'real',
    });

  } catch (errorApi) {
    // ── Fallback: Modo Simulado ────────────────────────────────────────────
    console.log(`[Demo] API no disponible (${errorApi.message?.slice(0, 60)}…) — usando modo simulado`);

    const simulado = respuestaSimulada(mensaje.trim(), sessionId || 'default');

    return res.json({
      ...simulado,
      escalado: false,
      modo:     'simulado',
    });
  }
});

/**
 * GET /config — Datos básicos del negocio para la UI del chat
 */
app.get('/config', (req, res) => {
  try {
    const config = loadBusinessConfig(BUSINESS_ID_DEMO);
    res.json({
      nombre:   config.negocio.nombre,
      agente:   config.agente.nombre,
      tipo:     config.negocio.tipo,
      telefono: config.negocio.telefono,
    });
  } catch {
    res.json({ nombre: 'Spa Zenith GDL', agente: 'Luna', tipo: 'spa', telefono: '+52 33 3641 7730' });
  }
});

// ─── Iniciar servidor y abrir navegador ──────────────────────────────────────

app.listen(PUERTO_DEMO, async () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   🎯  Dalux Agency — MODO DEMO                    ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║   URL:     ${URL_DEMO}                    ║`);
  console.log(`║   Negocio: Spa Zenith GDL                         ║`);
  console.log(`║   Agente:  Luna                                    ║`);
  console.log('║                                                   ║');
  console.log('║   ✅ Modo real: Claude API (si hay créditos)       ║');
  console.log('║   🔄 Fallback: Modo simulado (siempre funciona)    ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  if (!ES_PRODUCCION) {
    try {
      const open = (await import('open')).default;
      await open(URL_DEMO);
      console.log('[Demo] Navegador abierto en', URL_DEMO);
    } catch {
      console.log(`[Demo] Abre manualmente: ${URL_DEMO}`);
    }
  }
});
