/**
 * agent-core.js — Cerebro Principal del Agente Recepcionista IA
 * ─────────────────────────────────────────────────────────────
 * Orquesta todos los módulos: contexto, intención, respuesta Claude,
 * flujo de agendamiento y escalación a humano.
 *
 * Uso básico:
 *   const { AgentCore } = require('./agent-core');
 *   const config = require('../config/config-loader').loadBusinessConfig('spa-example');
 *   const agente = new AgentCore(config);
 *   const resultado = await agente.procesarMensaje('+5213312345678', 'Hola, quiero una cita');
 *
 * Dalux Agency — v1.0
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');

const { ContextManager }     = require('./context-manager');
const { detectIntent, requiereEscalacion } = require('./intent-detector');
const { CalendarIntegration } = require('./calendar-integration');

// ─── Constantes ──────────────────────────────────────────────────────────────

// Modelo Claude Haiku: rápido y económico para respuestas conversacionales
// Referencia: https://docs.claude.com/en/api/overview
const MODELO_CLAUDE = 'claude-haiku-4-5-20251001';

// Rutas de archivos de datos (relativas a la raíz del proyecto)
const RUTA_CITAS          = path.join(__dirname, '../data/appointments.json');
const RUTA_DISPONIBILIDAD = path.join(__dirname, '../data/availability.json');
const RUTA_ESCALACIONES   = path.join(__dirname, '../data/logs/escalaciones.json');

// ─── Clase principal ──────────────────────────────────────────────────────────

/**
 * AgentCore
 * Punto de entrada para procesar cada mensaje entrante.
 */
class AgentCore {
  /**
   * @param {object} businessConfig - Configuración completa del negocio (JSON)
   */
  constructor(businessConfig) {
    this.config = businessConfig;

    // Cliente de la API de Claude
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Gestores auxiliares
    this.contextManager      = new ContextManager();
    this.calendarIntegration = new CalendarIntegration(businessConfig);

    console.log(`[AgentCore] Agente iniciado para: ${businessConfig.negocio.nombre}`);
  }

  // ─── Método público principal ───────────────────────────────────────────────

  /**
   * Procesa un mensaje entrante y retorna la respuesta del agente.
   *
   * @param {string} userId  - Número de teléfono (+521XXXXXXXXXX) o ID de Instagram
   * @param {string} mensaje - Texto del mensaje del cliente
   * @param {string} canal   - 'whatsapp' | 'instagram'
   * @returns {Promise<object>} { respuesta, intencion, escalado, citaCreada, datosCita? }
   */
  async procesarMensaje(userId, mensaje, canal = 'whatsapp') {
    try {
      // 1. Obtener contexto actual de la conversación
      const contexto      = this.contextManager.obtenerContexto(userId);
      const esClienteNuevo = this.contextManager.esClienteNuevo(userId);

      // 2. Registrar mensaje del usuario en el historial
      this.contextManager.agregarMensaje(userId, 'user', mensaje);

      // 3. Detectar intención del mensaje
      const intencion = detectIntent(mensaje, contexto);

      // 4. Verificar si necesita escalación inmediata a humano
      if (requiereEscalacion(mensaje, intencion)) {
        return await this._manejarEscalacion(userId, mensaje, contexto);
      }

      // 5. Si hay flujo de agendamiento activo o el usuario quiere agendar
      if (intencion === 'agendar' || contexto.estadoAgendamiento) {
        return await this._manejarAgendamiento(userId, mensaje, contexto, canal);
      }

      // 6. Si quiere cancelar una cita
      if (intencion === 'cancelar') {
        return await this._manejarCancelacion(userId, mensaje, contexto);
      }

      // 7. Respuesta conversacional general vía Claude
      const respuesta = await this._generarRespuesta(
        userId, mensaje, contexto, intencion, esClienteNuevo
      );

      // 8. Registrar respuesta del agente en el historial
      this.contextManager.agregarMensaje(userId, 'assistant', respuesta);

      return {
        respuesta,
        intencion,
        escalado: false,
        citaCreada: false,
      };

    } catch (error) {
      console.error(`[AgentCore] Error procesando mensaje de ${userId}:`, error.message);
      return {
        respuesta: 'Disculpa, tuve un problema técnico momentáneo. Por favor intenta de nuevo en un momento. 🙏',
        intencion: 'error',
        escalado: false,
        citaCreada: false,
        error: error.message,
      };
    }
  }

  // ─── Generación de respuesta con Claude ────────────────────────────────────

  /**
   * Construye el system prompt con la personalidad y datos del negocio.
   *
   * @param {boolean} esClienteNuevo
   * @returns {string}
   */
  _construirSystemPrompt(esClienteNuevo) {
    const { negocio, agente, servicios, horarios, politicaCancelacion, tono } = this.config;

    // Instrucciones de tono según la personalidad del negocio
    const instruccionesTono = {
      formal:       'Usa un lenguaje formal y respetuoso. Habla de "usted". Sé preciso y profesional.',
      amigable:     'Usa un lenguaje cálido, amigable y cercano. Tutea al cliente. Puedes usar emojis con moderación.',
      profesional:  'Usa un lenguaje profesional pero accesible. Equilibra la calidez con la eficiencia.',
    };

    // Formatear lista de servicios
    const listaServicios = servicios
      .map(s => `  • ${s.nombre}: $${s.precio} MXN (duración: ${s.duracion} min)`)
      .join('\n');

    // Formatear horarios de atención
    const listaHorarios = Object.entries(horarios.dias)
      .map(([dia, h]) => `  • ${dia}: ${h.abre} – ${h.cierra}`)
      .join('\n');

    return `Eres ${agente.nombre}, el asistente virtual de ${negocio.nombre}.
Tipo de negocio: ${negocio.tipo}

${instruccionesTono[tono] || instruccionesTono.amigable}

━━━ INFORMACIÓN DEL NEGOCIO ━━━
Nombre:     ${negocio.nombre}
Dirección:  ${negocio.direccion}
Teléfono:   ${negocio.telefono}
Zona horaria: ${negocio.zonaHoraria}

━━━ HORARIOS DE ATENCIÓN ━━━
${listaHorarios}

━━━ SERVICIOS Y PRECIOS ━━━
${listaServicios}

━━━ POLÍTICA DE CANCELACIÓN ━━━
${politicaCancelacion}

━━━ REGLAS IMPORTANTES ━━━
1. Responde SIEMPRE en español mexicano natural.
2. Sé conciso — máximo 3-4 oraciones en cada mensaje (esto es WhatsApp).
3. Para agendar cita, guía al cliente paso a paso preguntando el servicio primero.
4. Si el cliente pregunta algo que no está en tu información, di que lo consultarás con el equipo.
5. NUNCA inventes precios, servicios ni horarios fuera de los listados.
6. NUNCA menciones que eres una IA ni que usas Claude o Anthropic.
7. Si el cliente insiste en hablar con una persona, dile que en breve lo contactarán.
${esClienteNuevo ? '8. Este es un cliente nuevo — salúdalo cordialmente y preséntate brevemente.' : ''}`.trim();
  }

  /**
   * Llama a la API de Claude y retorna el texto de respuesta.
   */
  async _generarRespuesta(userId, mensaje, contexto, intencion, esClienteNuevo) {
    const systemPrompt = this._construirSystemPrompt(esClienteNuevo);

    // Construir historial en formato requerido por la API de Claude
    // Solo los últimos 10 mensajes (ya gestionado por ContextManager)
    const mensajes = contexto.historial.map(m => ({
      role:    m.rol,
      content: m.contenido,
    }));

    // Garantizar que el último mensaje sea del usuario
    if (mensajes.length === 0 || mensajes[mensajes.length - 1].role !== 'user') {
      mensajes.push({ role: 'user', content: mensaje });
    }

    const respuesta = await this.anthropic.messages.create({
      model:      MODELO_CLAUDE,
      max_tokens: 500,
      system:     systemPrompt,
      messages:   mensajes,
    });

    return respuesta.content[0].text;
  }

  // ─── Flujo de agendamiento ──────────────────────────────────────────────────

  /**
   * Máquina de estados para el flujo de agendamiento paso a paso.
   * Pasos: seleccion_servicio → seleccion_fecha → confirmacion_nombre → guardar_cita
   */
  async _manejarAgendamiento(userId, mensaje, contexto, canal) {
    // Determinar paso actual (por defecto: inicio del flujo)
    const estado = contexto.estadoAgendamiento || { paso: 'seleccion_servicio' };

    switch (estado.paso) {

      // ── Paso 1: Mostrar servicios disponibles ────────────────────────────────
      case 'seleccion_servicio': {
        const listaServicios = this.config.servicios
          .map((s, i) => `${i + 1}. ${s.nombre} — $${s.precio} MXN (${s.duracion} min)`)
          .join('\n');

        const respuesta = [
          `¡Con gusto te ayudo a agendar! 📅`,
          ``,
          `¿Qué servicio te interesa?`,
          ``,
          listaServicios,
          ``,
          `Escribe el número o el nombre del servicio.`,
        ].join('\n');

        this.contextManager.actualizarEstadoAgendamiento(userId, { paso: 'seleccion_fecha' });
        this.contextManager.agregarMensaje(userId, 'assistant', respuesta);

        return { respuesta, intencion: 'agendar', escalado: false, citaCreada: false };
      }

      // ── Paso 2: Identificar servicio y mostrar disponibilidad ────────────────
      case 'seleccion_fecha': {
        const servicio = this._detectarServicio(mensaje);

        if (!servicio) {
          const respuesta = `No encontré ese servicio. Por favor escribe el número o el nombre exacto de la lista.`;
          return { respuesta, intencion: 'agendar', escalado: false, citaCreada: false };
        }

        const slots = await this._obtenerSlotsDisponibles();

        if (slots.length === 0) {
          const respuesta = `En este momento no tenemos horarios disponibles en los próximos días. Te sugerimos llamarnos directamente al ${this.config.negocio.telefono} para buscar una opción. 🙏`;
          this.contextManager.limpiarEstadoAgendamiento(userId);
          this.contextManager.agregarMensaje(userId, 'assistant', respuesta);
          return { respuesta, intencion: 'agendar', escalado: false, citaCreada: false };
        }

        const listaSlots = slots
          .slice(0, 6) // Mostrar máximo 6 opciones
          .map((s, i) => `${i + 1}. ${s.fechaTexto} a las ${s.hora}`)
          .join('\n');

        const respuesta = [
          `Excelente, elegiste: *${servicio.nombre}* ✅`,
          ``,
          `Horarios disponibles:`,
          ``,
          listaSlots,
          ``,
          `¿Cuál te funciona? Escribe el número.`,
        ].join('\n');

        this.contextManager.actualizarEstadoAgendamiento(userId, {
          paso:              'confirmacion_nombre',
          servicio,
          slotsDisponibles:  slots.slice(0, 6),
        });
        this.contextManager.agregarMensaje(userId, 'assistant', respuesta);

        return { respuesta, intencion: 'agendar', escalado: false, citaCreada: false };
      }

      // ── Paso 3: Confirmar slot seleccionado y pedir nombre ───────────────────
      case 'confirmacion_nombre': {
        const slots      = estado.slotsDisponibles || [];
        const indice     = parseInt(mensaje.trim()) - 1;

        if (isNaN(indice) || indice < 0 || indice >= slots.length) {
          const respuesta = `Por favor escribe el número del horario que prefieres (del 1 al ${slots.length}).`;
          return { respuesta, intencion: 'agendar', escalado: false, citaCreada: false };
        }

        const slotElegido = slots[indice];
        this.contextManager.actualizarEstadoAgendamiento(userId, {
          paso: 'guardar_cita',
          slotElegido,
        });

        const respuesta = `Perfecto! Horario seleccionado: ${slotElegido.fechaTexto} a las ${slotElegido.hora} 🗓\n\n¿Me das tu nombre completo para registrar la cita?`;
        this.contextManager.agregarMensaje(userId, 'assistant', respuesta);

        return { respuesta, intencion: 'agendar', escalado: false, citaCreada: false };
      }

      // ── Paso 4: Guardar cita (Ruta A: JSON o Ruta B: Google Calendar) ────────
      case 'guardar_cita': {
        const nombreCliente = mensaje.trim();

        // Validación básica del nombre
        if (nombreCliente.length < 2) {
          const respuesta = `¿Me puedes dar tu nombre completo para registrar la cita correctamente?`;
          return { respuesta, intencion: 'agendar', escalado: false, citaCreada: false };
        }

        const datosCita = {
          id:               `cita_${Date.now()}`,
          businessId:       this.config.negocio.id,
          clienteNombre:    nombreCliente,
          clienteContacto:  userId,
          canal,
          servicio:         estado.servicio,
          fecha:            estado.slotElegido.fecha,      // YYYY-MM-DD
          hora:             estado.slotElegido.hora,       // HH:MM
          creadaEn:         new Date().toISOString(),
          estado:           'confirmada',
        };

        // Intentar guardar según la ruta configurada
        let citaGuardada = false;

        if (this.config.agenda?.tipo === 'google_calendar') {
          // ─ Ruta B: Google Calendar ─────────────────────────────────────────
          try {
            await this.calendarIntegration.crearEvento(datosCita);
            citaGuardada = true;
            console.log(`[AgentCore] Cita en Google Calendar: ${datosCita.id}`);
          } catch (errorCal) {
            console.error('[AgentCore] Fallo Google Calendar, guardando en JSON como respaldo:', errorCal.message);
            this._guardarCitaJSON(datosCita); // Fallback a Ruta A
            citaGuardada = true;
          }
        } else {
          // ─ Ruta A: JSON local ───────────────────────────────────────────────
          this._guardarCitaJSON(datosCita);
          citaGuardada = true;
          console.log(`[AgentCore] Cita guardada en JSON: ${datosCita.id}`);
        }

        // Limpiar el flujo de agendamiento
        this.contextManager.limpiarEstadoAgendamiento(userId);

        const confirmacion = [
          `¡Listo, ${nombreCliente}! Tu cita está confirmada ✅`,
          ``,
          `📅 *${estado.slotElegido.fechaTexto}*`,
          `⏰ *${estado.slotElegido.hora}*`,
          `💆 *${estado.servicio.nombre}* — $${estado.servicio.precio} MXN`,
          ``,
          `Te esperamos en ${this.config.negocio.nombre} 🙌`,
          `Si necesitas cancelar o cambiar, contáctanos con al menos 24 horas de anticipación.`,
        ].join('\n');

        this.contextManager.agregarMensaje(userId, 'assistant', confirmacion);

        return {
          respuesta:   confirmacion,
          intencion:   'agendar',
          escalado:    false,
          citaCreada:  citaGuardada,
          datosCita,
        };
      }

      // ── Estado desconocido: reiniciar flujo ───────────────────────────────────
      default: {
        this.contextManager.limpiarEstadoAgendamiento(userId);
        return this._manejarAgendamiento(
          userId, mensaje,
          { ...contexto, estadoAgendamiento: { paso: 'seleccion_servicio' } },
          canal
        );
      }
    }
  }

  // ─── Escalación a humano ────────────────────────────────────────────────────

  /**
   * Responde que un humano lo atenderá y guarda el flag para el dueño.
   */
  async _manejarEscalacion(userId, mensaje, contexto) {
    this._registrarEscalacion(userId, mensaje);

    const respuesta = [
      `Entiendo tu situación y quiero asegurarme de atenderte de la mejor manera. 🙏`,
      `Un miembro de nuestro equipo se pondrá en contacto contigo a la brevedad.`,
      `Disculpa cualquier inconveniente.`,
    ].join('\n');

    this.contextManager.agregarMensaje(userId, 'assistant', respuesta);

    return {
      respuesta,
      intencion: 'escalacion',
      escalado:  true,
      citaCreada: false,
    };
  }

  /**
   * Maneja solicitudes de cancelación de cita.
   */
  async _manejarCancelacion(userId, mensaje, contexto) {
    const respuesta = await this._generarRespuesta(
      userId, mensaje, contexto, 'cancelar', false
    );
    this.contextManager.agregarMensaje(userId, 'assistant', respuesta);

    return {
      respuesta,
      intencion:  'cancelar',
      escalado:   false,
      citaCreada: false,
    };
  }

  // ─── Recordatorios ─────────────────────────────────────────────────────────

  /**
   * Genera la lista de citas del día siguiente para recordatorios manuales.
   * El dueño puede copiar esta lista y enviarla por WhatsApp a sus clientes.
   *
   * @returns {Array} Lista de citas de mañana ordenadas por hora
   */
  generarRecordatorios() {
    try {
      if (!fs.existsSync(RUTA_CITAS)) {
        console.log('[AgentCore] No existe appointments.json todavía.');
        return [];
      }

      const citas = JSON.parse(fs.readFileSync(RUTA_CITAS, 'utf8'));

      // Calcular fecha de mañana en formato YYYY-MM-DD
      const manana = new Date();
      manana.setDate(manana.getDate() + 1);
      const fechaManana = manana.toISOString().split('T')[0];

      const citasManana = citas
        .filter(c =>
          c.fecha === fechaManana &&
          c.estado !== 'cancelada' &&
          c.businessId === this.config.negocio.id
        )
        .sort((a, b) => a.hora.localeCompare(b.hora));

      console.log(`[AgentCore] Recordatorios para ${fechaManana}: ${citasManana.length} cita(s)`);
      return citasManana;

    } catch (error) {
      console.error('[AgentCore] Error generando recordatorios:', error.message);
      return [];
    }
  }

  // ─── Métodos privados de apoyo ──────────────────────────────────────────────

  /**
   * Guarda una cita en el archivo JSON local (Ruta A).
   */
  _guardarCitaJSON(datosCita) {
    try {
      // Crear directorio si no existe
      const dir = path.dirname(RUTA_CITAS);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let citas = [];
      if (fs.existsSync(RUTA_CITAS)) {
        citas = JSON.parse(fs.readFileSync(RUTA_CITAS, 'utf8'));
      }

      citas.push(datosCita);
      fs.writeFileSync(RUTA_CITAS, JSON.stringify(citas, null, 2));

    } catch (error) {
      console.error('[AgentCore] Error guardando cita en JSON:', error.message);
      throw error;
    }
  }

  /**
   * Obtiene slots de disponibilidad libres para los próximos días.
   */
  async _obtenerSlotsDisponibles() {
    try {
      if (!fs.existsSync(RUTA_DISPONIBILIDAD)) {
        console.warn('[AgentCore] No existe availability.json');
        return [];
      }

      const disponibilidad = JSON.parse(fs.readFileSync(RUTA_DISPONIBILIDAD, 'utf8'));
      const citas = fs.existsSync(RUTA_CITAS)
        ? JSON.parse(fs.readFileSync(RUTA_CITAS, 'utf8'))
        : [];

      const ahora = new Date();

      const slotsLibres = disponibilidad.slots.filter(slot => {
        // Excluir slots en el pasado
        const fechaSlot = new Date(`${slot.fecha}T${slot.hora}:00`);
        if (fechaSlot <= ahora) return false;

        // Excluir slots bloqueados manualmente
        if (slot.bloqueado) return false;

        // Excluir slots con cita confirmada para este negocio
        const ocupado = citas.some(c =>
          c.fecha === slot.fecha &&
          c.hora  === slot.hora  &&
          c.estado !== 'cancelada' &&
          c.businessId === this.config.negocio.id
        );

        return !ocupado;
      });

      return slotsLibres;

    } catch (error) {
      console.error('[AgentCore] Error obteniendo disponibilidad:', error.message);
      return [];
    }
  }

  /**
   * Detecta el servicio que el usuario quiere a partir de su mensaje.
   * Acepta número de lista ("1") o nombre parcial ("masaje").
   */
  _detectarServicio(mensaje) {
    const texto    = mensaje.toLowerCase().trim();
    const servicios = this.config.servicios;

    // Intentar por número de lista
    const numero = parseInt(texto);
    if (!isNaN(numero) && numero >= 1 && numero <= servicios.length) {
      return servicios[numero - 1];
    }

    // Intentar por coincidencia parcial en el nombre
    return servicios.find(s =>
      texto.includes(s.nombre.toLowerCase()) ||
      s.nombre.toLowerCase().includes(texto)
    ) || null;
  }

  /**
   * Registra una escalación en el archivo de logs para el dueño.
   */
  _registrarEscalacion(userId, mensaje) {
    try {
      const dir = path.dirname(RUTA_ESCALACIONES);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let escalaciones = [];
      if (fs.existsSync(RUTA_ESCALACIONES)) {
        escalaciones = JSON.parse(fs.readFileSync(RUTA_ESCALACIONES, 'utf8'));
      }

      escalaciones.push({
        id:        `esc_${Date.now()}`,
        userId,
        businessId: this.config.negocio.id,
        mensaje,
        timestamp: new Date().toISOString(),
        atendido:  false,
      });

      fs.writeFileSync(RUTA_ESCALACIONES, JSON.stringify(escalaciones, null, 2));

    } catch (error) {
      console.error('[AgentCore] Error registrando escalación:', error.message);
    }
  }
}

module.exports = { AgentCore };
