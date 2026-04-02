/**
 * dashboard.js — Lógica del Dashboard Operativo
 * ───────────────────────────────────────────────
 * Consume los endpoints de la API local (/api/*)
 * y renderiza los datos en el DOM sin frameworks.
 *
 * Auto-refresh cada 30 segundos.
 * Dalux Agency — v1.0
 */

// ─── Configuración ────────────────────────────────────────────────────────────

// URL base de la API (mismo origen que el dashboard)
const API_BASE = window.location.origin;

// Intervalo de auto-refresh en ms
const REFRESH_INTERVAL = 30_000;

// ─── Estado global ────────────────────────────────────────────────────────────

let ultimaActualizacion = null;
let timerRefresh        = null;
let negocioId           = '—';

// ─── Inicialización ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await cargarTodo();
  iniciarAutoRefresh();
  configurarBotonRefresh();
});

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

function iniciarAutoRefresh() {
  if (timerRefresh) clearInterval(timerRefresh);
  timerRefresh = setInterval(async () => {
    await cargarTodo();
  }, REFRESH_INTERVAL);
}

function configurarBotonRefresh() {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.classList.add('loading');
    await cargarTodo();
    btn.classList.remove('loading');
    // Reiniciar el timer para que no haga refresh doble
    iniciarAutoRefresh();
  });
}

// ─── Carga principal ──────────────────────────────────────────────────────────

async function cargarTodo() {
  try {
    // Cargar todos los datos en paralelo
    const [status, metricas, conversaciones, citasHoy, citasManana, escalaciones, disponibilidad] =
      await Promise.all([
        fetchJSON('/api/status'),
        fetchJSON('/api/metricas'),
        fetchJSON('/api/conversaciones?limite=20'),
        fetchJSON(`/api/citas?fecha=${fechaHoy()}`),
        fetchJSON(`/api/citas?fecha=${fechaManana()}`),
        fetchJSON('/api/escalaciones'),
        fetchJSON('/api/disponibilidad'),
      ]);

    // Actualizar nombre del negocio en topbar
    if (status?.businessId) {
      negocioId = status.businessId;
      const el = document.getElementById('business-name');
      if (el) el.textContent = status.businessId;
    }

    // Renderizar cada sección
    renderMetricas(metricas, escalaciones?.length ?? 0);
    renderConversaciones(conversaciones);
    renderCitas(citasHoy, citasManana);
    renderEscalaciones(escalaciones);
    renderDisponibilidad(disponibilidad, citasHoy, citasManana);

    // Actualizar timestamp
    ultimaActualizacion = new Date();
    actualizarTimestamp();

  } catch (error) {
    console.error('[Dashboard] Error cargando datos:', error);
    mostrarToast('Error conectando con el servidor', true);
  }
}

// ─── Helpers de fetch ─────────────────────────────────────────────────────────

async function fetchJSON(ruta) {
  try {
    const resp = await fetch(`${API_BASE}${ruta}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.warn(`[Dashboard] fetchJSON(${ruta}) falló:`, error.message);
    return null;
  }
}

// ─── Render: Métricas ─────────────────────────────────────────────────────────

function renderMetricas(metricas, pendEscalaciones) {
  if (!metricas) return;

  setEl('metric-mensajes',    metricas.totalMensajes ?? 0);
  setEl('metric-citas',       metricas.totalCitas ?? 0);
  setEl('metric-escalaciones', pendEscalaciones);
  setEl('metric-tasa',        metricas.tasaEscalacion ?? '0%');
}

// ─── Render: Conversaciones recientes ────────────────────────────────────────

function renderConversaciones(conversaciones) {
  const lista = document.getElementById('conv-list');
  if (!lista) return;

  // Filtrar últimas 24 horas
  const hace24h  = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recientes = (conversaciones || []).filter(
    c => new Date(c.timestamp) >= hace24h
  );

  // Actualizar badge
  setEl('conv-count', recientes.length);

  if (recientes.length === 0) {
    lista.innerHTML = `
      <li class="empty-state">
        <span class="empty-icon">💬</span>
        Sin conversaciones en las últimas 24 hrs
      </li>`;
    return;
  }

  lista.innerHTML = recientes.map(c => {
    const inicial  = (c.userId || '?')[0].toUpperCase();
    const esInsta  = c.canal === 'instagram';
    const idCorto  = c.userId?.length > 15
      ? c.userId.slice(0, 13) + '…'
      : (c.userId || 'Desconocido');
    const msgCorto = (c.mensaje || '').slice(0, 40) + ((c.mensaje?.length > 40) ? '…' : '');
    const hora     = formatHora(c.timestamp);

    return `
      <li class="conv-item">
        <div class="conv-avatar ${esInsta ? 'instagram' : ''}">${esInsta ? '📸' : inicial}</div>
        <div class="conv-info">
          <div class="conv-id">${idCorto}</div>
          <div class="conv-msg">"${escapar(msgCorto)}"</div>
        </div>
        <div class="conv-meta">
          <span class="conv-time">${hora}</span>
          <span class="intent-chip intent-${c.intencion || 'otro'}">${c.intencion || 'otro'}</span>
        </div>
      </li>`;
  }).join('');
}

// ─── Render: Citas hoy y mañana ───────────────────────────────────────────────

function renderCitas(citasHoy, citasManana) {
  const lista = document.getElementById('citas-list');
  if (!lista) return;

  const todasCitas = [
    ...(citasHoy   || []).map(c => ({ ...c, _etiqueta: 'Hoy' })),
    ...(citasManana || []).map(c => ({ ...c, _etiqueta: 'Mañana' })),
  ];

  // Actualizar badge
  setEl('citas-count', todasCitas.length);

  if (todasCitas.length === 0) {
    lista.innerHTML = `
      <li class="empty-state">
        <span class="empty-icon">📅</span>
        Sin citas para hoy ni mañana
      </li>`;
    return;
  }

  lista.innerHTML = todasCitas.map(c => {
    const precio = c.servicio?.precio
      ? `$${c.servicio.precio.toLocaleString('es-MX')}`
      : '';

    return `
      <li class="cita-item">
        <div class="cita-hora-badge">
          <span class="cita-hora">${c.hora || '—'}</span>
          <span class="cita-fecha-tag">${c._etiqueta}</span>
        </div>
        <div class="cita-info">
          <div class="cita-nombre">${escapar(c.clienteNombre || 'Sin nombre')}</div>
          <div class="cita-servicio">${escapar(c.servicio?.nombre || '—')}</div>
        </div>
        ${precio ? `<div class="cita-precio">${precio}</div>` : ''}
      </li>`;
  }).join('');
}

// ─── Render: Escalaciones pendientes ─────────────────────────────────────────

function renderEscalaciones(escalaciones) {
  const lista = document.getElementById('esc-list');
  if (!lista) return;

  const pendientes = (escalaciones || []).filter(e => !e.atendido);
  setEl('esc-count', pendientes.length);

  if (pendientes.length === 0) {
    lista.innerHTML = `
      <li class="empty-state">
        <span class="empty-icon">✅</span>
        Sin escalaciones pendientes
      </li>`;
    return;
  }

  lista.innerHTML = pendientes.map(e => {
    const msgCorto = (e.mensaje || '').slice(0, 80) + ((e.mensaje?.length > 80) ? '…' : '');
    return `
      <li class="esc-item">
        <div class="esc-header">
          <span class="esc-user">⚠️ ${e.userId?.slice(0, 18) || 'Desconocido'}</span>
          <span class="esc-time">${formatHora(e.timestamp)}</span>
        </div>
        <div class="esc-msg">"${escapar(msgCorto)}"</div>
        <button class="btn-atender" data-id="${e.id}" onclick="marcarAtendida('${e.id}', this)">
          Marcar atendida
        </button>
      </li>`;
  }).join('');
}

/**
 * Marca una escalación como atendida en el servidor y la quita del panel.
 */
async function marcarAtendida(id, btn) {
  try {
    btn.textContent = 'Guardando…';
    btn.disabled    = true;

    const resp = await fetch(`${API_BASE}/api/escalaciones/${id}/atendida`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Eliminar el item del DOM
    btn.closest('.esc-item').remove();

    // Actualizar badge
    const lista    = document.getElementById('esc-list');
    const restantes = lista?.querySelectorAll('.esc-item').length ?? 0;
    setEl('esc-count', restantes);

    if (restantes === 0) {
      lista.innerHTML = `
        <li class="empty-state">
          <span class="empty-icon">✅</span>
          Sin escalaciones pendientes
        </li>`;
    }

    mostrarToast('Escalación marcada como atendida ✓');

    // Actualizar métrica del badge principal
    const badgeMetrica = document.getElementById('metric-escalaciones');
    if (badgeMetrica) {
      const actual = parseInt(badgeMetrica.textContent) || 0;
      badgeMetrica.textContent = Math.max(0, actual - 1);
    }

  } catch (error) {
    console.error('[Dashboard] Error marcando escalación:', error);
    btn.textContent = 'Marcar atendida';
    btn.disabled    = false;
    mostrarToast('Error al guardar. Intenta de nuevo.', true);
  }
}

// ─── Render: Disponibilidad semanal ──────────────────────────────────────────

function renderDisponibilidad(disponibilidad, citasHoy, citasManana) {
  const contenedor = document.getElementById('week-grid');
  if (!contenedor || !disponibilidad?.slots) return;

  const todosLosSlots = disponibilidad.slots;

  // Obtener las fechas únicas de los slots (próximos 7 días)
  const fechasUnicas = [...new Set(todosLosSlots.map(s => s.fecha))]
    .sort()
    .slice(0, 7);

  // Obtener las horas únicas ordenadas
  const horasUnicas = [...new Set(todosLosSlots.map(s => s.hora))].sort();

  // Citas ya agendadas (para marcar slots ocupados)
  const citasAgendadas = [
    ...(citasHoy   || []),
    ...(citasManana || []),
  ];

  const hoy = fechaHoy();

  // Construir cabecera de días
  const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  let html = `
    <div class="week-header hora-col">Hora</div>
    ${fechasUnicas.map(f => {
      const d       = new Date(f + 'T12:00:00');
      const diaNombre = diasSemana[d.getDay()];
      const diaNum  = d.getDate();
      const esHoy   = f === hoy;
      return `<div class="week-header ${esHoy ? 'today' : ''}">${diaNombre}<br>${diaNum}</div>`;
    }).join('')}
  `;

  // Construir filas por hora
  for (const hora of horasUnicas) {
    html += `<div class="slot-hora">${hora}</div>`;

    for (const fecha of fechasUnicas) {
      const slot = todosLosSlots.find(s => s.fecha === fecha && s.hora === hora);

      if (!slot) {
        html += `<div class="slot-cell"><button class="slot-btn vacio" disabled></button></div>`;
        continue;
      }

      const ahora       = new Date();
      const fechaSlot   = new Date(`${fecha}T${hora}:00`);
      const esPasado    = fechaSlot <= ahora;
      const esBloqueado = slot.bloqueado;
      const esOcupado   = citasAgendadas.some(
        c => c.fecha === fecha && c.hora === hora
      );

      let clase  = 'libre';
      let label  = hora;
      let titulo = 'Clic para bloquear este horario';

      if (esPasado)    { clase = 'pasado';   titulo = 'Horario pasado'; }
      else if (esBloqueado) { clase = 'bloqueado'; label = '🔒'; titulo = 'Bloqueado — clic para desbloquear'; }
      else if (esOcupado)   { clase = 'ocupado';   label = '✓';  titulo = 'Cita agendada'; }

      const onclick = (!esPasado && !esOcupado)
        ? `onclick="toggleBloqueo('${fecha}', '${hora}', ${esBloqueado}, this)"`
        : '';

      html += `
        <div class="slot-cell">
          <button class="slot-btn ${clase}" title="${titulo}" ${onclick}>
            ${label}
          </button>
        </div>`;
    }
  }

  contenedor.innerHTML = html;
}

/**
 * Bloquea o desbloquea un slot de disponibilidad.
 */
async function toggleBloqueo(fecha, hora, estaBloqueado, btn) {
  try {
    btn.disabled    = true;
    btn.textContent = '…';

    const resp = await fetch(`${API_BASE}/api/disponibilidad/bloquear`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fecha, hora, bloqueado: !estaBloqueado }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Actualizar visual del botón
    if (!estaBloqueado) {
      btn.className = 'slot-btn bloqueado';
      btn.textContent = '🔒';
      btn.title = 'Bloqueado — clic para desbloquear';
      btn.onclick = () => toggleBloqueo(fecha, hora, true, btn);
      mostrarToast(`Horario ${hora} del ${fecha} bloqueado`);
    } else {
      btn.className = 'slot-btn libre';
      btn.textContent = hora;
      btn.title = 'Clic para bloquear este horario';
      btn.onclick = () => toggleBloqueo(fecha, hora, false, btn);
      mostrarToast(`Horario ${hora} del ${fecha} desbloqueado`);
    }

    btn.disabled = false;

  } catch (error) {
    console.error('[Dashboard] Error toggling bloqueo:', error);
    btn.disabled    = false;
    btn.textContent = hora;
    mostrarToast('Error al actualizar. Intenta de nuevo.', true);
  }
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** Establece el textContent de un elemento por ID */
function setEl(id, valor) {
  const el = document.getElementById(id);
  if (el) el.textContent = valor;
}

/** Formatea un timestamp ISO a hora legible en español */
function formatHora(timestamp) {
  if (!timestamp) return '—';
  try {
    return new Date(timestamp).toLocaleTimeString('es-MX', {
      hour:   '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Mexico_City',
    });
  } catch { return '—'; }
}

/** Retorna la fecha de hoy en formato YYYY-MM-DD */
function fechaHoy() {
  return new Date().toISOString().split('T')[0];
}

/** Retorna la fecha de mañana en formato YYYY-MM-DD */
function fechaManana() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

/** Actualiza el texto del timestamp en la topbar */
function actualizarTimestamp() {
  if (!ultimaActualizacion) return;
  const el = document.getElementById('refresh-time');
  if (el) {
    el.textContent = `actualizado ${ultimaActualizacion.toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })}`;
  }
}

/** Escapa HTML básico para evitar XSS con datos del usuario */
function escapar(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Muestra un toast de notificación temporal */
function mostrarToast(mensaje, esError = false) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  toast.textContent = mensaje;
  toast.className   = `toast${esError ? ' error' : ''}`;

  // Forzar reflow para reiniciar la animación
  toast.offsetHeight;
  toast.classList.add('show');

  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Exponer funciones globales que se usan en onclick del HTML
window.marcarAtendida = marcarAtendida;
window.toggleBloqueo  = toggleBloqueo;
