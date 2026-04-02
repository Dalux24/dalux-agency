/**
 * webhook.js — Manejador de Webhooks Entrantes
 * ─────────────────────────────────────────────
 * Procesa mensajes de tres canales:
 *   1. Twilio WhatsApp Sandbox (demo / MVP)
 *   2. WhatsApp Cloud API de Meta (producción)
 *   3. Instagram Messaging API de Meta (mismo App de Facebook)
 *
 * Para cada canal: extrae usuario + mensaje, llama al agente,
 * envía la respuesta de vuelta y registra la interacción en logs.
 *
 * Dalux Agency — v1.0
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const twilio  = require('twilio');
const fs      = require('fs');
const path    = require('path');

const { AgentCore }         = require('../agent/agent-core');
const { loadBusinessConfig } = require('../config/config-loader');

// ─── Rutas de archivos ────────────────────────────────────────────────────────

const RUTA_CONVERSACIONES = path.join(__dirname, '../data/logs/conversations.json');

// ─── Inicialización del agente ────────────────────────────────────────────────

// Carga la configuración del negocio activo desde la variable de entorno BUSINESS_ID
const businessId = process.env.BUSINESS_ID || 'spa-example';
let agente;
try {
  const config = loadBusinessConfig(businessId);
  agente = new AgentCore(config);
  console.log(`[Webhook] Agente cargado para negocio: "${businessId}"`);
} catch (error) {
  console.error(`[Webhook] Error cargando configuración "${businessId}":`, error.message);
  process.exit(1);
}

// ─── Clientes de API ──────────────────────────────────────────────────────────

// Cliente de Twilio para enviar mensajes de vuelta al Sandbox de WhatsApp
const clienteTwilio = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Router de Express — se monta en server.js
const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// CANAL 1: TWILIO WHATSAPP SANDBOX
// Endpoint: POST /webhook/twilio
// ──────────────────────────────────────────────────────────────────────────────

router.post('/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  // Twilio envía el cuerpo como application/x-www-form-urlencoded
  const { From, Body, To } = req.body;

  if (!From || !Body) {
    console.warn('[Webhook/Twilio] Mensaje incompleto recibido:', req.body);
    return res.status(400).send('Parámetros incompletos');
  }

  // Extraer el número de teléfono limpio (sin el prefijo "whatsapp:")
  const userId  = From.replace('whatsapp:', '').trim();
  const mensaje = Body.trim();

  console.log(`[Webhook/Twilio] Mensaje de ${userId}: "${mensaje}"`);

  try {
    // Procesar mensaje con el agente IA
    const resultado = await agente.procesarMensaje(userId, mensaje, 'whatsapp');

    // Enviar respuesta de vuelta al usuario via Twilio
    await clienteTwilio.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER || To,
      to:   From,
      body: resultado.respuesta,
    });

    // Registrar la interacción en el log
    _registrarConversacion({
      canal:     'whatsapp_twilio',
      userId,
      mensaje,
      respuesta: resultado.respuesta,
      intencion: resultado.intencion,
      escalado:  resultado.escalado,
    });

    // Twilio espera una respuesta 200 OK (sin cuerpo de TwiML, ya enviamos el mensaje)
    res.status(200).send('OK');

  } catch (error) {
    console.error('[Webhook/Twilio] Error procesando mensaje:', error.message);
    res.status(500).send('Error interno');
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// CANAL 2: WHATSAPP CLOUD API DE META (PRODUCCIÓN)
// Endpoints:
//   GET  /webhook/meta  → verificación del webhook por Meta
//   POST /webhook/meta  → mensajes entrantes de WhatsApp + Instagram
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /webhook/meta — Verificación de webhook requerida por Meta
 * Meta envía una petición GET con hub.challenge para confirmar que el
 * servidor es válido. Respondemos con el challenge si el token coincide.
 */
router.get('/meta', (req, res) => {
  const modo      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const tokenEsperado = process.env.META_VERIFY_TOKEN;

  if (modo === 'subscribe' && token === tokenEsperado) {
    console.log('[Webhook/Meta] Webhook verificado por Meta ✅');
    res.status(200).send(challenge);
  } else {
    console.warn('[Webhook/Meta] Verificación fallida. Token inválido.');
    res.status(403).send('Token de verificación incorrecto');
  }
});

/**
 * POST /webhook/meta — Mensajes entrantes de WhatsApp Cloud API e Instagram
 * El mismo endpoint maneja ambos canales (se diferencian por object type).
 */
router.post('/meta', express.json(), async (req, res) => {
  // Meta espera respuesta 200 inmediata para evitar reintentos
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;

  // Verificar que es un evento de WhatsApp o Instagram
  if (!body?.entry) {
    console.warn('[Webhook/Meta] Payload sin entry:', body);
    return;
  }

  for (const entry of body.entry) {
    for (const change of (entry.changes || [])) {
      const value = change.value;

      // ── WhatsApp Cloud API ────────────────────────────────────────────────
      if (body.object === 'whatsapp_business_account') {
        await _procesarMensajeMeta(value, 'whatsapp');
      }

      // ── Instagram Messaging API ───────────────────────────────────────────
      if (body.object === 'instagram') {
        await _procesarMensajeInstagram(entry, 'instagram');
      }
    }
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// FUNCIONES PRIVADAS DE PROCESAMIENTO
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Procesa mensajes entrantes de WhatsApp Cloud API.
 *
 * @param {object} value - Objeto value del change de Meta
 * @param {string} canal - 'whatsapp'
 */
async function _procesarMensajeMeta(value, canal) {
  const mensajes = value?.messages;
  if (!mensajes?.length) return;

  for (const msg of mensajes) {
    // Solo procesar mensajes de texto por ahora
    if (msg.type !== 'text') {
      console.log(`[Webhook/Meta] Tipo de mensaje no soportado: ${msg.type}`);
      continue;
    }

    const userId  = msg.from;     // Número E.164 ej: 5213312345678
    const mensaje = msg.text.body.trim();
    const phoneNumberId = value.metadata?.phone_number_id;

    console.log(`[Webhook/Meta] Mensaje de ${userId}: "${mensaje}"`);

    try {
      const resultado = await agente.procesarMensaje(userId, mensaje, canal);

      // Enviar respuesta via WhatsApp Cloud API
      await _enviarMensajeMeta(phoneNumberId, userId, resultado.respuesta);

      _registrarConversacion({
        canal:     'whatsapp_meta',
        userId,
        mensaje,
        respuesta: resultado.respuesta,
        intencion: resultado.intencion,
        escalado:  resultado.escalado,
      });

    } catch (error) {
      console.error(`[Webhook/Meta] Error procesando mensaje de ${userId}:`, error.message);
    }
  }
}

/**
 * Procesa mensajes entrantes de Instagram Messaging API.
 *
 * @param {object} entry - Objeto entry del payload de Meta
 * @param {string} canal - 'instagram'
 */
async function _procesarMensajeInstagram(entry, canal) {
  const messaging = entry.messaging;
  if (!messaging?.length) return;

  for (const evento of messaging) {
    // Solo mensajes de texto
    if (!evento.message?.text) continue;

    // Ignorar mensajes del propio bot para evitar loops
    if (evento.message.is_echo) continue;

    const userId  = evento.sender.id;
    const mensaje = evento.message.text.trim();
    const pageId  = entry.id;

    console.log(`[Webhook/Instagram] Mensaje de ${userId}: "${mensaje}"`);

    try {
      const resultado = await agente.procesarMensaje(userId, mensaje, canal);

      // Enviar respuesta via Instagram Messaging API
      await _enviarMensajeInstagram(pageId, userId, resultado.respuesta);

      _registrarConversacion({
        canal:     'instagram',
        userId,
        mensaje,
        respuesta: resultado.respuesta,
        intencion: resultado.intencion,
        escalado:  resultado.escalado,
      });

    } catch (error) {
      console.error(`[Webhook/Instagram] Error procesando mensaje de ${userId}:`, error.message);
    }
  }
}

/**
 * Envía un mensaje de texto via WhatsApp Cloud API.
 *
 * @param {string} phoneNumberId - ID del número de teléfono de Meta
 * @param {string} destinatario  - Número del destinatario (E.164)
 * @param {string} texto         - Texto a enviar
 */
async function _enviarMensajeMeta(phoneNumberId, destinatario, texto) {
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!token) {
    console.error('[Webhook/Meta] META_WHATSAPP_TOKEN no configurado en .env');
    return;
  }

  // Usar fetch nativo de Node 18+
  const respuesta = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:                destinatario,
        type:              'text',
        text:              { body: texto },
      }),
    }
  );

  if (!respuesta.ok) {
    const errorData = await respuesta.json();
    console.error('[Webhook/Meta] Error enviando mensaje:', JSON.stringify(errorData));
  }
}

/**
 * Envía un mensaje de texto via Instagram Messaging API (Graph API).
 *
 * @param {string} pageId       - ID de la página de Facebook
 * @param {string} destinatario - ID de usuario de Instagram
 * @param {string} texto        - Texto a enviar
 */
async function _enviarMensajeInstagram(pageId, destinatario, texto) {
  const token = process.env.META_INSTAGRAM_TOKEN;
  if (!token) {
    console.error('[Webhook/Instagram] META_INSTAGRAM_TOKEN no configurado en .env');
    return;
  }

  const respuesta = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        recipient: { id: destinatario },
        message:   { text: texto },
        messaging_type: 'RESPONSE',
      }),
    }
  );

  if (!respuesta.ok) {
    const errorData = await respuesta.json();
    console.error('[Webhook/Instagram] Error enviando mensaje:', JSON.stringify(errorData));
  }
}

/**
 * Registra cada interacción en el archivo de logs.
 * Útil para el dashboard y para auditoría.
 *
 * @param {object} datos - { canal, userId, mensaje, respuesta, intencion, escalado }
 */
function _registrarConversacion(datos) {
  try {
    const dir = path.dirname(RUTA_CONVERSACIONES);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let conversaciones = [];
    if (fs.existsSync(RUTA_CONVERSACIONES)) {
      conversaciones = JSON.parse(fs.readFileSync(RUTA_CONVERSACIONES, 'utf8'));
    }

    conversaciones.push({
      id:        `conv_${Date.now()}`,
      timestamp: new Date().toISOString(),
      businessId,
      ...datos,
    });

    // Mantener solo las últimas 1000 interacciones en el log para no crecer indefinidamente
    if (conversaciones.length > 1000) {
      conversaciones = conversaciones.slice(-1000);
    }

    fs.writeFileSync(RUTA_CONVERSACIONES, JSON.stringify(conversaciones, null, 2));

  } catch (error) {
    console.error('[Webhook] Error registrando conversación:', error.message);
  }
}

module.exports = router;
