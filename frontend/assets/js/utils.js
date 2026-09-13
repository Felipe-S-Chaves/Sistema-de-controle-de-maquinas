/**
 * Utilitarios compartilhados: formatacao, feedback visual,
 * estados de carregamento e helpers de formulario.
 */
window.Utils = (function () {
  'use strict';

  // ---------------------------------------------------------------
  // Formatacao
  // ---------------------------------------------------------------

  /** "1600.00" -> "R$ 1.600,00" */
  function formatMoney(value) {
    var number = parseMoney(value);
    if (number === null) return 'R$ 0,00';
    return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Aceita "1.234,56", "1234.56", number. Retorna Number ou null. */
  function parseMoney(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;

    var raw = String(value).trim().replace(/\s|R\$/g, '');
    if (!raw) return null;

    var hasComma = raw.indexOf(',') !== -1;
    var hasDot = raw.indexOf('.') !== -1;
    if (hasComma && hasDot) {
      raw = raw.lastIndexOf(',') > raw.lastIndexOf('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '');
    } else if (hasComma) {
      raw = raw.replace(',', '.');
    }

    if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
    var parsed = Number(raw);
    return isFinite(parsed) ? parsed : null;
  }

  /** Trabalha em centavos para nao acumular erro de ponto flutuante. */
  function toCents(value) {
    var number = parseMoney(value);
    return number === null ? null : Math.round(number * 100);
  }

  function centsToMoney(cents) {
    if (cents === null || cents === undefined) return 'R$ 0,00';
    return formatMoney(cents / 100);
  }

  function formatDate(value) {
    var date = toDate(value);
    if (!date) return '-';
    return date.toLocaleDateString('pt-BR');
  }

  function formatDateTime(value) {
    var date = toDate(value);
    if (!date) return '-';
    return date.toLocaleDateString('pt-BR') + ' ' +
      date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function toDate(value) {
    if (!value) return null;
    var date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  /** Data de hoje em AAAA-MM-DD (para inputs date). */
  function todayInput() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatDocument(doc, type) {
    if (!doc) return '-';
    var digits = String(doc).replace(/\D/g, '');
    if (digits.length === 14 || type === 'cnpj') {
      return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }

  function formatPhone(phone) {
    if (!phone) return '-';
    var d = String(phone).replace(/\D/g, '');
    if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    return phone;
  }

  /** Identificacao visual da maquina: NUMERO - NOME (nunca o id do banco). */
  function machineLabel(machine) {
    if (!machine) return '-';
    var number = machine.machine_number || machine.number || '';
    var name = machine.machine_name || machine.name || '';
    return number ? number + ' - ' + name : name;
  }

  /** Escapa texto antes de injetar em HTML (defesa contra XSS). */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------
  // Badges de status
  // ---------------------------------------------------------------
  var STATUS_MAP = {
    active: { label: 'Ativa', css: 'text-bg-success' },
    maintenance: { label: 'Manutencao', css: 'text-bg-warning' },
    inactive: { label: 'Inativo', css: 'text-bg-secondary' },
    confirmed: { label: 'Confirmada', css: 'text-bg-success' },
    cancelled: { label: 'Cancelada', css: 'text-bg-danger' }
  };

  function statusBadge(status, ownerContext) {
    var map = STATUS_MAP[status] || { label: status || '-', css: 'text-bg-secondary' };
    var label = map.label;
    if (ownerContext && status === 'active') label = 'Ativo';
    return '<span class="badge badge-status ' + map.css + '">' + escapeHtml(label) + '</span>';
  }

  // ---------------------------------------------------------------
  // Feedback: toasts
  // ---------------------------------------------------------------
  function toastContainer() {
    var el = document.getElementById('toastContainer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toastContainer';
      el.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, type) {
    var palette = { success: 'text-bg-success', error: 'text-bg-danger', warning: 'text-bg-warning', info: 'text-bg-primary' };
    var css = palette[type] || palette.info;

    var el = document.createElement('div');
    el.className = 'toast align-items-center border-0 ' + css;
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.innerHTML =
      '<div class="d-flex">' +
      '<div class="toast-body">' + escapeHtml(message) + '</div>' +
      '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button>' +
      '</div>';

    toastContainer().appendChild(el);
    var instance = new bootstrap.Toast(el, { delay: type === 'error' ? 6500 : 3800 });
    instance.show();
    el.addEventListener('hidden.bs.toast', function () { el.remove(); });
  }

  var notify = {
    success: function (m) { toast(m, 'success'); },
    error: function (m) { toast(m, 'error'); },
    warning: function (m) { toast(m, 'warning'); },
    info: function (m) { toast(m, 'info'); }
  };

  // ---------------------------------------------------------------
  // Estados de tela
  // ---------------------------------------------------------------
  function renderLoading(container, rows) {
    if (!container) return;
    var html = '';
    for (var i = 0; i < (rows || 4); i += 1) {
      html += '<div class="skeleton mb-2" style="height:44px"></div>';
    }
    container.innerHTML = html;
  }

  function renderEmpty(container, message, icon) {
    if (!container) return;
    container.innerHTML =
      '<div class="state-block">' +
      '<div class="state-icon">' + (icon || '&#128193;') + '</div>' +
      '<p class="mb-0">' + escapeHtml(message || 'Nenhum registro encontrado.') + '</p>' +
      '</div>';
  }

  function renderError(container, message, onRetry) {
    if (!container) return;
    container.innerHTML =
      '<div class="state-block">' +
      '<div class="state-icon text-danger">&#9888;</div>' +
      '<p class="mb-2">' + escapeHtml(message || 'Nao foi possivel carregar os dados.') + '</p>' +
      (onRetry ? '<button class="btn btn-sm btn-outline-primary" id="btnRetryState">Tentar novamente</button>' : '') +
      '</div>';
    if (onRetry) {
      var btn = container.querySelector('#btnRetryState');
      if (btn) btn.addEventListener('click', onRetry);
    }
  }

  /** Evita cliques repetidos durante uma operacao assincrona. */
  function setButtonLoading(button, loading, loadingText) {
    if (!button) return;
    if (loading) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>' +
        escapeHtml(loadingText || 'Aguarde...');
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }

  // ---------------------------------------------------------------
  // Formularios
  // ---------------------------------------------------------------
  function clearFieldErrors(form) {
    if (!form) return;
    form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
    form.querySelectorAll('[data-error-for]').forEach(function (el) { el.textContent = ''; });
  }

  /** Aplica os erros por campo devolvidos pela API. */
  function applyFieldErrors(form, details) {
    if (!form || !details) return;
    Object.keys(details).forEach(function (field) {
      var input = form.querySelector('[name="' + field + '"]');
      var slot = form.querySelector('[data-error-for="' + field + '"]');
      if (input) input.classList.add('is-invalid');
      if (slot) slot.textContent = details[field];
    });
    var firstInvalid = form.querySelector('.is-invalid');
    if (firstInvalid && firstInvalid.focus) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /** Trata um erro da API de forma consistente em toda a aplicacao. */
  function handleApiError(error, form) {
    if (form && error && error.details) {
      clearFieldErrors(form);
      applyFieldErrors(form, error.details);
    }
    notify.error((error && error.message) || 'Nao foi possivel completar a operacao.');
  }

  function formToObject(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      data[key] = typeof value === 'string' ? value.trim() : value;
    });
    return data;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, wait || 300);
    };
  }

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /** Confirmacao antes de operacoes destrutivas. */
  function confirmAction(options) {
    return new Promise(function (resolve) {
      var modalEl = document.getElementById('confirmModal');
      if (!modalEl) { resolve(window.confirm(options.message)); return; }

      modalEl.querySelector('[data-confirm-title]').textContent = options.title || 'Confirmar operacao';
      modalEl.querySelector('[data-confirm-message]').textContent = options.message || 'Deseja continuar?';

      var reasonWrap = modalEl.querySelector('[data-confirm-reason-wrap]');
      var reasonInput = modalEl.querySelector('[data-confirm-reason]');
      var reasonError = modalEl.querySelector('[data-confirm-reason-error]');
      reasonInput.value = '';
      reasonError.textContent = '';
      reasonInput.classList.remove('is-invalid');
      reasonWrap.classList.toggle('d-none', !options.requireReason);

      var confirmBtn = modalEl.querySelector('[data-confirm-ok]');
      confirmBtn.className = 'btn btn-touch ' + (options.danger ? 'btn-danger' : 'btn-primary');
      confirmBtn.textContent = options.confirmText || 'Confirmar';

      var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      var settled = false;

      function onConfirm() {
        if (options.requireReason) {
          var reason = reasonInput.value.trim();
          if (reason.length < 10) {
            reasonInput.classList.add('is-invalid');
            reasonError.textContent = 'Descreva o motivo com pelo menos 10 caracteres.';
            return;
          }
          settled = true;
          cleanup();
          modal.hide();
          resolve({ confirmed: true, reason: reason });
          return;
        }
        settled = true;
        cleanup();
        modal.hide();
        resolve({ confirmed: true, reason: null });
      }

      function onHidden() {
        if (!settled) { cleanup(); resolve({ confirmed: false, reason: null }); }
      }

      function cleanup() {
        confirmBtn.removeEventListener('click', onConfirm);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
      }

      confirmBtn.addEventListener('click', onConfirm);
      modalEl.addEventListener('hidden.bs.modal', onHidden);
      modal.show();
    });
  }

  /** Paginacao acessivel e compacta. */
  function renderPagination(container, pagination, onChange) {
    if (!container) return;
    var totalPages = pagination.totalPages || 0;
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    var current = pagination.page;
    var pages = [];
    var start = Math.max(1, current - 1);
    var end = Math.min(totalPages, current + 1);
    if (start > 1) pages.push(1);
    if (start > 2) pages.push('...');
    for (var i = start; i <= end; i += 1) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    if (end < totalPages) pages.push(totalPages);

    var html = '<nav aria-label="Paginacao"><ul class="pagination pagination-sm justify-content-center mb-0">';
    html += '<li class="page-item' + (current === 1 ? ' disabled' : '') + '">' +
      '<button class="page-link" data-page="' + (current - 1) + '" aria-label="Anterior">&laquo;</button></li>';
    pages.forEach(function (p) {
      if (p === '...') { html += '<li class="page-item disabled"><span class="page-link">...</span></li>'; return; }
      html += '<li class="page-item' + (p === current ? ' active' : '') + '">' +
        '<button class="page-link" data-page="' + p + '">' + p + '</button></li>';
    });
    html += '<li class="page-item' + (current === totalPages ? ' disabled' : '') + '">' +
      '<button class="page-link" data-page="' + (current + 1) + '" aria-label="Proxima">&raquo;</button></li>';
    html += '</ul></nav>';
    html += '<p class="text-center text-muted small mt-2 mb-0">' +
      pagination.total + ' registro(s) - pagina ' + current + ' de ' + totalPages + '</p>';

    container.innerHTML = html;
    container.querySelectorAll('button[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var page = parseInt(btn.getAttribute('data-page'), 10);
        if (page >= 1 && page <= totalPages && page !== current) onChange(page);
      });
    });
  }

  return {
    formatMoney: formatMoney, parseMoney: parseMoney, toCents: toCents, centsToMoney: centsToMoney,
    formatDate: formatDate, formatDateTime: formatDateTime, todayInput: todayInput,
    formatDocument: formatDocument, formatPhone: formatPhone, machineLabel: machineLabel,
    escapeHtml: escapeHtml, statusBadge: statusBadge,
    notify: notify, renderLoading: renderLoading, renderEmpty: renderEmpty, renderError: renderError,
    setButtonLoading: setButtonLoading,
    clearFieldErrors: clearFieldErrors, applyFieldErrors: applyFieldErrors, handleApiError: handleApiError,
    formToObject: formToObject, debounce: debounce, queryParam: queryParam,
    confirmAction: confirmAction, renderPagination: renderPagination
  };
}());
