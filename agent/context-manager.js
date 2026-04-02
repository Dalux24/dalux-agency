/**
 * context-manager.js — Gestión de contexto por conversación
 * ─────────────────────────────────────────────────────────
 * Mantiene en memoria el historial de mensajes y el estado del
 * flujo de agendamiento para cada usuario (número de teléfono o ID).
 *
 * En producción: migrar this.conversaciones a Redis o Supabase
 * para persistencia entre reinicios del servidor.
 *
 * Dalux Agency — v1.0
 */

// Máximo de mensajes a retener por conversación
const MAX_HISTORIAL = 10;

// Tiempo de inactividad antes de limpiar una conversación (24 horas en ms)
const TIEMPO_EXPIRACION_MS = 24 * 60 * 60 * 1000;

/**
 * ContextManager
 * Gestiona el estado de cada conversación en memoria.
 */
class ContextManager {
  constructor() {
    // Map principal: userId (string) → objeto de contexto
    this.conversaciones = new Map();

    // Limpiar conversaciones antiguas cada hora
    this._iniciarLimpieza();
  }

  /**
   * Obtiene el contexto de un usuario.
   * Si no existe, crea uno nuevo (cliente nuevo).
   *
   * @param {string} userId - Número de teléfono o ID de Instagram
   * @returns {object} Objeto de contexto
   */
  obtenerContexto(userId) {
    if (!this.conversaciones.has(userId)) {
      this.conversaciones.set(userId, {
        userId,
        historial: [],              // Array de { rol, contenido, timestamp }
        estadoAgendamiento: null,   // null | objeto con paso actual del flujo
        primeraInteraccion: new Date().toISOString(),
        ultimaInteraccion: new Date().toISOString(),
        totalInteracciones: 0,
        esClienteNuevo: true,
      });
    }
    return this.conversaciones.get(userId);
  }

  /**
   * Agrega un mensaje al historial de la conversación.
   * Mantiene solo los últimos MAX_HISTORIAL mensajes.
   *
   * @param {string} userId
   * @param {'user'|'assistant'} rol
   * @param {string} contenido
   */
  agregarMensaje(userId, rol, contenido) {
    const contexto = this.obtenerContexto(userId);

    contexto.historial.push({
      rol,
      contenido,
      timestamp: new Date().toISOString(),
    });

    // Recortar historial si supera el límite
    if (contexto.historial.length > MAX_HISTORIAL) {
      contexto.historial = contexto.historial.slice(-MAX_HISTORIAL);
    }

    // Actualizar metadatos
    contexto.ultimaInteraccion = new Date().toISOString();
    if (rol === 'user') {
      contexto.totalInteracciones++;
      contexto.esClienteNuevo = false; // Ya no es nuevo tras el primer mensaje
    }
  }

  /**
   * Actualiza el estado del flujo de agendamiento para un usuario.
   * Cada paso del flujo agrega información al objeto de estado.
   *
   * @param {string} userId
   * @param {object} estado - Objeto con { paso, ...datosParciales }
   */
  actualizarEstadoAgendamiento(userId, estado) {
    const contexto = this.obtenerContexto(userId);
    // Mezclar con estado anterior para no perder datos previos del flujo
    contexto.estadoAgendamiento = {
      ...(contexto.estadoAgendamiento || {}),
      ...estado,
    };
  }

  /**
   * Limpia el estado de agendamiento.
   * Llamar después de confirmar o cancelar una cita.
   *
   * @param {string} userId
   */
  limpiarEstadoAgendamiento(userId) {
    const contexto = this.obtenerContexto(userId);
    contexto.estadoAgendamiento = null;
  }

  /**
   * Verifica si un usuario es cliente nuevo (sin historial previo).
   *
   * @param {string} userId
   * @returns {boolean}
   */
  esClienteNuevo(userId) {
    if (!this.conversaciones.has(userId)) return true;
    const contexto = this.conversaciones.get(userId);
    return contexto.historial.length === 0;
  }

  /**
   * Elimina conversaciones sin actividad por más de TIEMPO_EXPIRACION_MS.
   * Se ejecuta automáticamente cada hora.
   */
  limpiarConversacionesAntiguas() {
    const ahora = Date.now();
    let eliminadas = 0;

    for (const [userId, contexto] of this.conversaciones) {
      const ultimaActividad = new Date(contexto.ultimaInteraccion).getTime();
      if (ahora - ultimaActividad > TIEMPO_EXPIRACION_MS) {
        this.conversaciones.delete(userId);
        eliminadas++;
      }
    }

    if (eliminadas > 0) {
      console.log(`[ContextManager] Conversaciones expiradas eliminadas: ${eliminadas}`);
    }
  }

  /**
   * Retorna estadísticas actuales para el dashboard.
   *
   * @returns {object}
   */
  obtenerEstadisticas() {
    return {
      conversacionesActivas: this.conversaciones.size,
      usuarios: Array.from(this.conversaciones.values()).map(c => ({
        userId: c.userId,
        totalInteracciones: c.totalInteracciones,
        ultimaInteraccion: c.ultimaInteraccion,
        enFlujoAgendamiento: c.estadoAgendamiento !== null,
      })),
    };
  }

  /**
   * Inicia un intervalo de limpieza automática cada hora.
   */
  _iniciarLimpieza() {
    setInterval(() => {
      this.limpiarConversacionesAntiguas();
    }, 60 * 60 * 1000); // Cada hora
  }
}

module.exports = { ContextManager };
