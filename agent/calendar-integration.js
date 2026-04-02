/**
 * calendar-integration.js — Integración con Google Calendar (Ruta B)
 * ──────────────────────────────────────────────────────────────────
 * Se activa solo cuando el negocio tiene: agenda.tipo === 'google_calendar'
 *
 * Configuración requerida en .env para cada cliente con Google Calendar:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI
 *   GOOGLE_ACCESS_TOKEN_{BUSINESS_ID_EN_MAYÚSCULAS}
 *   GOOGLE_REFRESH_TOKEN_{BUSINESS_ID_EN_MAYÚSCULAS}
 *
 * Ejemplo para businessId 'dentista-guerrero':
 *   GOOGLE_ACCESS_TOKEN_DENTISTA_GUERRERO=ya29.xxxx
 *   GOOGLE_REFRESH_TOKEN_DENTISTA_GUERRERO=1//xxxx
 *
 * Para obtener tokens: ver README.md → sección "Configurar Google Calendar"
 *
 * Dalux Agency — v1.0
 */

// Verificar si googleapis está disponible antes de requerirlo
let google;
try {
  ({ google } = require('googleapis'));
} catch {
  // googleapis es opcional — solo necesario para Ruta B
  google = null;
}

/**
 * CalendarIntegration
 * Crea y consulta eventos en Google Calendar del negocio.
 */
class CalendarIntegration {
  /**
   * @param {object} businessConfig - Configuración completa del negocio
   */
  constructor(businessConfig) {
    this.config = businessConfig;
    this.calendarId = businessConfig.agenda?.googleCalendarId || 'primary';
    this.oauth2Client = null;
    this.habilitado = businessConfig.agenda?.tipo === 'google_calendar';

    if (this.habilitado) {
      this._inicializarCliente();
    }
  }

  /**
   * Inicializa el cliente OAuth2 de Google usando variables de entorno.
   * Los tokens deben haberse generado previamente (ver README).
   */
  _inicializarCliente() {
    if (!google) {
      console.error('[CalendarIntegration] El paquete "googleapis" no está instalado. Ejecuta: npm install googleapis');
      this.habilitado = false;
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';

    if (!clientId || !clientSecret) {
      console.warn('[CalendarIntegration] GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET no configurados.');
      this.habilitado = false;
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Construir nombre de la variable de entorno para este negocio específico
    // Ejemplo: businessId 'dentista-guerrero' → 'DENTISTA_GUERRERO'
    const envKey = this.config.negocio.id.toUpperCase().replace(/-/g, '_');

    const accessToken = process.env[`GOOGLE_ACCESS_TOKEN_${envKey}`];
    const refreshToken = process.env[`GOOGLE_REFRESH_TOKEN_${envKey}`];

    if (!accessToken && !refreshToken) {
      console.warn(
        `[CalendarIntegration] Tokens de Google no configurados para "${this.config.negocio.id}". ` +
        `Agrega GOOGLE_ACCESS_TOKEN_${envKey} y GOOGLE_REFRESH_TOKEN_${envKey} al .env`
      );
      this.habilitado = false;
      return;
    }

    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Auto-renovar el access_token cuando expire usando el refresh_token
    this.oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        console.log(`[CalendarIntegration] Refresh token renovado para ${this.config.negocio.id}`);
      }
    });

    console.log(`[CalendarIntegration] Google Calendar listo para: ${this.config.negocio.nombre}`);
  }

  /**
   * Crea un evento de cita en Google Calendar.
   *
   * @param {object} datosCita - Objeto con los datos de la cita
   * @param {string} datosCita.id
   * @param {string} datosCita.clienteNombre
   * @param {string} datosCita.clienteContacto
   * @param {string} datosCita.canal
   * @param {object} datosCita.servicio - { nombre, precio, duracion }
   * @param {string} datosCita.fecha - Formato: YYYY-MM-DD
   * @param {string} datosCita.hora  - Formato: HH:MM
   * @returns {object} Evento creado (respuesta de Google Calendar API)
   */
  async crearEvento(datosCita) {
    if (!this.habilitado || !this.oauth2Client) {
      throw new Error(
        `Google Calendar no está habilitado para "${this.config.negocio.id}". ` +
        'Revisa la configuración en .env y business config.'
      );
    }

    const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

    const duracionMin = datosCita.servicio.duracion || 60;
    const fechaInicio = new Date(`${datosCita.fecha}T${datosCita.hora}:00`);
    const fechaFin   = new Date(fechaInicio.getTime() + duracionMin * 60 * 1000);
    const zonaHoraria = this.config.negocio.zonaHoraria || 'America/Mexico_City';

    const evento = {
      summary: `${datosCita.servicio.nombre} — ${datosCita.clienteNombre}`,
      description: [
        `👤 Cliente: ${datosCita.clienteNombre}`,
        `📱 Contacto: ${datosCita.clienteContacto}`,
        `📲 Canal: ${datosCita.canal}`,
        `💆 Servicio: ${datosCita.servicio.nombre}`,
        `💰 Precio: $${datosCita.servicio.precio} MXN`,
        `🆔 ID Cita: ${datosCita.id}`,
        `🤖 Agendado por: Dalux Agency AI Receptionist`,
      ].join('\n'),
      start: {
        dateTime: fechaInicio.toISOString(),
        timeZone: zonaHoraria,
      },
      end: {
        dateTime: fechaFin.toISOString(),
        timeZone: zonaHoraria,
      },
      // Recordatorios automáticos
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },   // 1 hora antes
          { method: 'popup', minutes: 1440 },  // 24 horas antes
        ],
      },
      // Color azul para citas agendadas por el agente IA
      colorId: '1',
    };

    try {
      const respuesta = await calendar.events.insert({
        calendarId: this.calendarId,
        resource: evento,
      });

      console.log(`[CalendarIntegration] Evento creado: ${respuesta.data.id} | ${datosCita.clienteNombre}`);
      return respuesta.data;

    } catch (error) {
      console.error(`[CalendarIntegration] Error creando evento en Google Calendar:`, error.message);
      throw error;
    }
  }

  /**
   * Obtiene los eventos del calendario para los próximos N días.
   * Útil para calcular disponibilidad real en Ruta B.
   *
   * @param {number} diasAdelante - Cuántos días hacia adelante consultar
   * @returns {Array} Lista de eventos
   */
  async obtenerEventos(diasAdelante = 7) {
    if (!this.habilitado || !this.oauth2Client) {
      return [];
    }

    const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    const zonaHoraria = this.config.negocio.zonaHoraria || 'America/Mexico_City';

    const ahora = new Date();
    const hasta = new Date();
    hasta.setDate(hasta.getDate() + diasAdelante);

    try {
      const respuesta = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin: ahora.toISOString(),
        timeMax: hasta.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: zonaHoraria,
      });

      return respuesta.data.items || [];

    } catch (error) {
      console.error(`[CalendarIntegration] Error consultando eventos:`, error.message);
      return [];
    }
  }
}

module.exports = { CalendarIntegration };
