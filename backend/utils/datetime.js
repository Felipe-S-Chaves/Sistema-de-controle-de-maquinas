'use strict';

const config = require('../config/env');

/** Data/hora atual formatada como 'YYYY-MM-DD HH:MM:SS' no fuso da aplicacao. */
function nowForDb(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(date);
  return parts.replace('T', ' ');
}

/** Converte um Date/string para 'YYYY-MM-DD HH:MM:SS'. */
function toDbDateTime(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return nowForDb(date);
}

/** 'YYYY-MM-DD' -> inicio do dia. */
function startOfDay(dateStr) {
  return `${dateStr} 00:00:00`;
}

/** 'YYYY-MM-DD' -> fim do dia. */
function endOfDay(dateStr) {
  return `${dateStr} 23:59:59`;
}

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Data local (YYYY-MM-DD) de hoje no fuso da aplicacao. */
function today() {
  return nowForDb().slice(0, 10);
}

/**
 * Resolve o filtro de periodo do dashboard/relatorios.
 * Aceita: today | week | month | last_month | custom | all
 */
function resolvePeriod(period, startDate, endDate) {
  const base = today();
  const [y, m, d] = base.split('-').map(Number);

  const fmt = (yy, mm, dd) =>
    `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  const lastDayOfMonth = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();

  switch (period) {
    case 'today':
      return { from: startOfDay(base), to: endOfDay(base), label: 'Hoje' };

    case 'week': {
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=dom
      const monday = new Date(Date.UTC(y, m - 1, d - ((weekday + 6) % 7)));
      const iso = monday.toISOString().slice(0, 10);
      return { from: startOfDay(iso), to: endOfDay(base), label: 'Esta semana' };
    }

    case 'month':
      return { from: startOfDay(fmt(y, m, 1)), to: endOfDay(base), label: 'Este mes' };

    case 'last_month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return {
        from: startOfDay(fmt(py, pm, 1)),
        to: endOfDay(fmt(py, pm, lastDayOfMonth(py, pm))),
        label: 'Mes anterior'
      };
    }

    case 'custom': {
      if (!isValidDateString(startDate) || !isValidDateString(endDate)) return null;
      if (startDate > endDate) return null;
      return { from: startOfDay(startDate), to: endOfDay(endDate), label: 'Periodo personalizado' };
    }

    case 'all':
      return { from: null, to: null, label: 'Todo o periodo' };

    default:
      return { from: startOfDay(fmt(y, m, 1)), to: endOfDay(base), label: 'Este mes' };
  }
}

module.exports = {
  nowForDb, toDbDateTime, startOfDay, endOfDay,
  isValidDateString, today, resolvePeriod
};
