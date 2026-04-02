/**
 * config-loader.js — Cargador de configuración de negocios
 * ─────────────────────────────────────────────────────────
 * Lee el JSON de configuración de un negocio desde config/businesses/.
 * Onboardear un cliente nuevo = crear su archivo JSON, sin tocar código.
 *
 * Uso:
 *   const { loadBusinessConfig } = require('./config-loader');
 *   const config = loadBusinessConfig('spa-zenith');
 *
 * Dalux Agency — v1.0
 */

const fs   = require('fs');
const path = require('path');

// Directorio donde viven las configuraciones de negocios
const DIR_BUSINESSES = path.join(__dirname, 'businesses');

/**
 * Carga y valida la configuración de un negocio por su ID.
 *
 * @param {string} businessId - Nombre del archivo sin extensión (ej: 'spa-zenith')
 * @returns {object} Configuración completa del negocio
 * @throws {Error} Si el archivo no existe o la config es inválida
 */
function loadBusinessConfig(businessId) {
  if (!businessId || typeof businessId !== 'string') {
    throw new Error('[ConfigLoader] businessId debe ser un string no vacío');
  }

  // Sanitizar: evitar path traversal (ej: "../../etc/passwd")
  const nombreLimpio = path.basename(businessId.trim());
  const rutaArchivo  = path.join(DIR_BUSINESSES, `${nombreLimpio}.json`);

  if (!fs.existsSync(rutaArchivo)) {
    const disponibles = listarNegocios();
    throw new Error(
      `[ConfigLoader] Configuración no encontrada: "${nombreLimpio}.json"\n` +
      `Negocios disponibles: ${disponibles.join(', ')}\n` +
      `Ruta buscada: ${rutaArchivo}`
    );
  }

  let config;
  try {
    const contenido = fs.readFileSync(rutaArchivo, 'utf8');
    config = JSON.parse(contenido);
  } catch (error) {
    throw new Error(
      `[ConfigLoader] Error parseando "${nombreLimpio}.json": ${error.message}`
    );
  }

  // Validar campos obligatorios
  _validarConfig(config, nombreLimpio);

  return config;
}

/**
 * Lista todos los negocios configurados en el directorio businesses/.
 *
 * @returns {string[]} Array de IDs de negocios (sin extensión .json)
 */
function listarNegocios() {
  try {
    return fs.readdirSync(DIR_BUSINESSES)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

/**
 * Valida que la configuración tenga todos los campos requeridos.
 * Lanza un error descriptivo si falta alguno.
 *
 * @param {object} config     - Objeto de configuración parseado
 * @param {string} businessId - ID del negocio (para mensajes de error)
 */
function _validarConfig(config, businessId) {
  const camposRequeridos = [
    'negocio',
    'negocio.id',
    'negocio.nombre',
    'negocio.tipo',
    'negocio.direccion',
    'negocio.telefono',
    'agente',
    'agente.nombre',
    'horarios',
    'horarios.dias',
    'servicios',
    'politicaCancelacion',
    'agenda',
    'agenda.tipo',
  ];

  for (const campo of camposRequeridos) {
    const partes = campo.split('.');
    let valor = config;
    for (const parte of partes) {
      valor = valor?.[parte];
    }
    if (valor === undefined || valor === null || valor === '') {
      throw new Error(
        `[ConfigLoader] Campo requerido faltante en "${businessId}.json": "${campo}"`
      );
    }
  }

  // Validar que haya al menos un servicio
  if (!Array.isArray(config.servicios) || config.servicios.length === 0) {
    throw new Error(
      `[ConfigLoader] "${businessId}.json" debe tener al menos un servicio en el array "servicios"`
    );
  }

  // Validar tipo de agenda
  const tiposValidos = ['json_local', 'google_calendar'];
  if (!tiposValidos.includes(config.agenda.tipo)) {
    throw new Error(
      `[ConfigLoader] Tipo de agenda inválido en "${businessId}.json": "${config.agenda.tipo}". ` +
      `Opciones válidas: ${tiposValidos.join(', ')}`
    );
  }
}

module.exports = { loadBusinessConfig, listarNegocios };
