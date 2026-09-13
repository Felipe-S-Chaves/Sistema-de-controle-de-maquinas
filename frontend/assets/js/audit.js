/** Trilha de auditoria (somente administradores). */
(function () {
  'use strict';

  var state = { page: 1, pageSize: 20, entity: '', startDate: '', endDate: '' };

  var ACTION_LABELS = {
    create: 'Criacao',
    create_exception: 'Criacao com excecao',
    update: 'Edicao',
    cancel: 'Cancelamento',
    status_change: 'Alteracao de status',
    login: 'Login',
    login_failed: 'Tentativa de login',
    logout: 'Logout',
    change_password: 'Alteracao de senha'
  };

  var ENTITY_LABELS = {
    collection: 'Coleta', owner: 'Proprietario', machine: 'Maquina', user: 'Usuario', auth: 'Autenticacao'
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    document.getElementById('entityFilter').addEventListener('change', function (e) {
      state.entity = e.target.value; state.page = 1; load();
    });
    ['startDate', 'endDate'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        state.startDate = document.getElementById('startDate').value;
        state.endDate = document.getElementById('endDate').value;
        state.page = 1;
        load();
      });
    });

    load();
  });

  function load() {
    var container = document.getElementById('auditList');
    Utils.renderLoading(container, 6);

    var params = { page: state.page, pageSize: state.pageSize, entity: state.entity || null };
    if (state.startDate && state.endDate) {
      params.period = 'custom';
      params.start_date = state.startDate;
      params.end_date = state.endDate;
    } else {
      params.period = 'all';
    }

    Api.get('/audit-logs', params)
      .then(function (payload) {
        render(payload.data);
        Utils.renderPagination(document.getElementById('auditPagination'), payload.pagination, function (page) {
          state.page = page; load(); window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  function render(items) {
    var container = document.getElementById('auditList');

    if (!items.length) {
      Utils.renderEmpty(container, 'Nenhum registro de auditoria neste filtro.', '&#128269;');
      return;
    }

    var rows = items.map(function (log) {
      var entity = ENTITY_LABELS[log.entity] || log.entity;
      var action = ACTION_LABELS[log.action] || log.action;
      var link = entityLink(log);

      return '<tr>' +
        '<td data-label="Data">' + Utils.formatDateTime(log.created_at) + '</td>' +
        '<td data-label="Usuario">' + Utils.escapeHtml(log.user_name || 'Sistema') + '</td>' +
        '<td data-label="Entidade">' + Utils.escapeHtml(entity) + (link ? ' ' + link : '') + '</td>' +
        '<td data-label="Operacao"><span class="badge ' + actionBadge(log.action) + ' badge-status">' +
        Utils.escapeHtml(action) + '</span></td>' +
        '<td data-label="Motivo" class="text-break-anywhere">' +
        (log.reason ? Utils.escapeHtml(log.reason) : '-') + '</td>' +
        '<td data-label="" class="cell-actions text-end">' +
        (log.old_values || log.new_values
          ? '<button class="btn btn-sm btn-outline-secondary" data-details=\'' +
            Utils.escapeHtml(JSON.stringify({ old: log.old_values, new: log.new_values })) + '\'>Valores</button>'
          : '') +
        '</td></tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-sm table-hover align-middle mb-0">' +
      '<thead><tr><th>Data</th><th>Usuario</th><th>Entidade</th>' +
      '<th>Operacao</th><th>Motivo</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div id="auditDetails" class="mt-3"></div>';

    container.querySelectorAll('[data-details]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showDetails(JSON.parse(btn.getAttribute('data-details')));
      });
    });
  }

  function showDetails(values) {
    var box = document.getElementById('auditDetails');
    box.innerHTML =
      '<div class="card"><div class="card-header d-flex justify-content-between align-items-center">' +
      '<span>Valores registrados</span>' +
      '<button class="btn btn-sm btn-outline-secondary" id="btnCloseDetails">Fechar</button></div>' +
      '<div class="card-body"><div class="row g-3">' +
      column('Valores anteriores', values.old) +
      column('Valores novos', values.new) +
      '</div></div></div>';

    document.getElementById('btnCloseDetails').addEventListener('click', function () { box.innerHTML = ''; });
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function column(title, data) {
    if (!data) return '';
    var rows = Object.keys(data).map(function (key) {
      var value = data[key];
      if (value === null || value === undefined) value = '-';
      if (typeof value === 'object') value = JSON.stringify(value);
      return '<dt class="col-6 fw-normal text-muted small">' + Utils.escapeHtml(key) + '</dt>' +
        '<dd class="col-6 small text-break-anywhere">' + Utils.escapeHtml(String(value)) + '</dd>';
    }).join('');

    return '<div class="col-12 col-md-6"><h6 class="small text-uppercase text-muted">' +
      Utils.escapeHtml(title) + '</h6><dl class="row mb-0">' + rows + '</dl></div>';
  }

  function entityLink(log) {
    if (!log.entity_id) return '';
    var routes = {
      collection: '/collection-detail.html?id=',
      owner: '/owner-detail.html?id=',
      machine: '/machine-detail.html?id='
    };
    if (!routes[log.entity]) return '';
    return '<a class="small" href="' + routes[log.entity] + log.entity_id + '">#' + log.entity_id + '</a>';
  }

  function actionBadge(action) {
    if (action === 'cancel' || action === 'login_failed') return 'text-bg-danger';
    if (action === 'create_exception') return 'text-bg-warning';
    if (action === 'create') return 'text-bg-success';
    if (action === 'update' || action === 'status_change') return 'text-bg-primary';
    return 'text-bg-secondary';
  }
}());
