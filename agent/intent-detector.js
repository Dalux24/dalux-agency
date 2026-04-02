/**
 * intent-detector.js — Detección de intenciones por palabras clave
 * ─────────────────────────────────────────────────────────────────
 * Identifica la intención del mensaje del cliente sin consumir tokens
 * de la API. Rápido, determinista y sin costo adicional.
 *
 * Intenciones soportadas:
 *   agendar | precio | ubicacion | horarios | cancelar | queja | humano | saludo | otro
 *
 * Dalux Agency — v1.0
 */

/**
 * Mapa de intenciones con sus palabras clave en español mexicano.
 * El orden importa: las primeras intenciones tienen prioridad en empate.
 */
const MAPA_INTENCIONES = {
  // El usuario quiere hablar con una persona real (alta prioridad)
  humano: [
    'hablar con alguien', 'hablar con una persona', 'persona real',
    'hablar con el dueño', 'hablar con el dueno', 'quiero hablar con',
    'operador', 'humano', 'agente humano', 'con quien hablo',
    'necesito ayuda real', 'no eres útil', 'no eres util',
  ],

  // El usuario tiene una queja o está molesto
  queja: [
    'queja', 'mal servicio', 'decepcionado', 'decepcionada',
    'no quedé', 'no quede', 'mala atención', 'mala atencion',
    'pésimo', 'pesimo', 'terrible', 'horrible', 'reclamo',
    'problema con', 'no funcionó', 'no funciono', 'molesto', 'molesta',
    'enojado', 'enojada', 'inconformidad', 'quiero quejarme',
  ],

  // El usuario quiere agendar, reservar o apartar una cita
  agendar: [
    'agendar', 'cita', 'reservar', 'reservación', 'reservacion',
    'quiero una cita', 'quiero un servicio', 'necesito cita',
    'hacer cita', 'apartar', 'disponibilidad', 'horario libre',
    'cuando tienen lugar', 'puedo ir', 'me pueden atender',
    'quiero que me atiendan', 'turno', 'appointment',
  ],

  // El usuario quiere cancelar o reagendar su cita
  cancelar: [
    'cancelar', 'cancela', 'cancelación', 'cancelacion',
    'ya no voy', 'no puedo ir', 'cambiar cita', 'mover cita',
    'reagendar', 'reprogramar', 'cambiar mi cita', 'mover mi cita',
  ],

  // El usuario pregunta por precios
  precio: [
    'precio', 'costo', 'cuánto', 'cuanto', 'cobran', 'vale',
    'tarifa', 'cuánto cuesta', 'cuanto cuesta', 'cuánto es', 'cuanto es',
    'precios', 'costos', 'cuanto cobran', 'cuánto cobran',
    'qué cuesta', 'que cuesta', 'tarifas', 'promoción', 'promocion',
  ],

  // El usuario pregunta por dirección o cómo llegar
  ubicacion: [
    'dónde', 'donde', 'dirección', 'direccion', 'ubicación',
    'ubicacion', 'están ubicados', 'estan ubicados', 'cómo llego',
    'como llego', 'maps', 'google maps', 'localización', 'localizacion',
    'colonía', 'colonia', 'calle', 'domicilio',
  ],

  // El usuario pregunta por horarios de atención
  horarios: [
    'horario', 'hora', 'abren', 'cierran', 'atención',
    'atencion', 'días', 'dias', 'abiertos', 'cerrados',
    'trabajan', 'cuando abren', 'qué días', 'que dias',
    'hasta qué hora', 'hasta que hora', 'desde qué hora',
    'lunes', 'martes', 'miércoles', 'miercoles', 'jueves',
    'viernes', 'sábado', 'sabado', 'domingo', 'fin de semana',
  ],

  // Saludos iniciales
  saludo: [
    'hola', 'buenos días', 'buenos dias', 'buenas tardes',
    'buenas noches', 'buenas', 'hey', 'qué tal', 'que tal',
    'buen día', 'buen dia', 'saludos', 'hi', 'hello',
  ],
};

/**
 * Detecta la intención principal del mensaje.
 *
 * @param {string} mensaje - Mensaje del cliente
 * @param {object} contexto - Contexto de la conversación (historial, estadoAgendamiento)
 * @returns {string} Intención detectada
 */
function detectIntent(mensaje, contexto) {
  const mensajeLower = mensaje.toLowerCase().trim();

  // Si hay un flujo de agendamiento activo, mantener intención 'agendar'
  if (contexto.estadoAgendamiento) {
    return 'agendar';
  }

  // Calcular score de coincidencias para cada intención
  const scores = {};

  for (const [intencion, palabrasClave] of Object.entries(MAPA_INTENCIONES)) {
    scores[intencion] = palabrasClave.filter(frase =>
      mensajeLower.includes(frase)
    ).length;
  }

  // Encontrar la intención con mayor score
  const ganadora = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)[0];

  if (ganadora) {
    return ganadora[0];
  }

  // Si es la primera interacción del usuario, asumir saludo
  if (contexto.historial.length <= 1) {
    return 'saludo';
  }

  // Sin coincidencias claras: intención desconocida
  return 'otro';
}

/**
 * Verifica si un mensaje indica que el usuario necesita escalación a humano.
 * Se separa de detectIntent para poder verificarlo antes que cualquier otro flujo.
 *
 * @param {string} mensaje
 * @param {string} intencion - Intención ya detectada
 * @returns {boolean}
 */
function requiereEscalacion(mensaje, intencion) {
  return intencion === 'humano' || intencion === 'queja';
}

module.exports = { detectIntent, requiereEscalacion };
