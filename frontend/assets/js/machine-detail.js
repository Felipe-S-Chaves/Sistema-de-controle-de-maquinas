/** Pagina da maquina: identificacao, resumo e historico paginado. */
(function () {
  'use strict';

  var machineId = null;
  var historyState = { page: 1, pageSize: 15, period: 'all', startDate: null, endDate: null };

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;
    machineId = Utils.queryParam('id');
    if (!machineId) {
      Utils.renderError(document.getElementById('machineContent'), 'Maquina nao informada.');
      return;
    }
    load();
  });

  function load() {
    var container = document.getElementById('machineContent');
    Utils.renderLoading(container, 6);

    Api.get('/machines/' + machineId, { period: 'month' })
      .then(function (payload) {
        render(payload.data);
        loadHistory();
      })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  function render(machine) {
    var label = machine.number + ' - ' + machine.name;
    document.getElementById('crumbName').textContent = label;
    document.title = label + ' - Controle de Maquinas';

    var s = machine.summary;
    var last = s.last_collection;
    var monthClass = Number(s.month.total_value) < 0 ? 'value-negative' : 'value-positive';

    document.getElementById('machineContent').innerHTML =
      '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">' +
      '  <div class="min-w-0">' +
      '    <h1 class="h4 mb-1 text-break-anywhere">' + Utils.escapeHtml(label) + '</h1>' +
      '    <p class="mb-1 small text-muted">Proprietario: ' +
      '<a href="/owner-detail.html?id=' + machine.owner_id + '">' + Utils.escapeHtml(machine.owner_name) + '</a></p>' +
      '    <div>' + Utils.statusBadge(machine.status) + '</div>' +
      '  </div>' +
      '  <div class="d-flex gap-2 flex-wrap">' +
      '    <a class="btn btn-primary btn-touch" href="/collection-new.html?machine_id=' + machine.id + '">Nova coleta</a>' +
      '    <a class="btn btn-outline-primary btn-touch" href="/reports.html?machine_id=' + machine.id + '">Relatorio</a>' +
      '  </div>' +
      '</div>' +

      '<div class="row g-3 mb-3">' +
      '  <div class="col-12 col-lg-6">' +
      '    <div class="card h-100"><div class="card-header">Ultima leitura</div><div class="card-body">' +
      (last
        ? '<div class="row g-2 mb-3">' +
          '  <div class="col-6"><div class="reading-box"><div class="reading-label">Entrada</div>' +
          '    <div class="reading-value">' + Utils.formatMoney(last.current_entry_value) + '</div></div></div>' +
          '  <div class="col-6"><div class="reading-box"><div class="reading-label">Saida</div>' +
          '    <div class="reading-value">' + Utils.formatMoney(last.current_exit_value) + '</div></div></div>' +
          '</div>' +
          '<dl class="row mb-0 small">' +
          infoRow('Entrada apurada', Utils.formatMoney(last.calculated_entry_value)) +
          infoRow('Saida apurada', Utils.formatMoney(last.calculated_exit_value)) +
          infoRow('Valor apurado', '<strong>' + Utils.formatMoney(last.calculated_total_value) + '</strong>') +
          infoRow('Data da coleta', Utils.formatDateTime(last.collected_at)) +
          '</dl>'
        : '<div class="state-block py-4"><div class="state-icon">&#128203;</div>' +
          '<p class="mb-2">Esta maquina ainda nao possui coletas.</p>' +
          '<a class="btn btn-sm btn-primary" href="/collection-new.html?machine_id=' + machine.id + '">Registrar primeira coleta</a></div>') +
      '    </div></div>' +
      '  </div>' +

      '  <div class="col-12 col-lg-6">' +
      '    <div class="card h-100"><div class="card-header">Dados e totais</div><div class="card-body">' +
      '      <dl class="row mb-0 small">' +
      infoRow('Modelo', Utils.escapeHtml(machine.model || '-')) +
      infoRow('Fabricante', Utils.escapeHtml(machine.manufacturer || '-')) +
      infoRow('Numero de serie', Utils.escapeHtml(machine.serial_number || '-')) +
      infoRow('Instalacao', machine.installation_date ? Utils.formatDate(machine.installation_date) : '-') +
      infoRow('Coletas no mes', String(s.month.collections_count)) +
      infoRow('Entrada apurada no mes', Utils.formatMoney(s.month.total_entry)) +
      infoRow('Saida apurada no mes', Utils.formatMoney(s.month.total_exit)) +
      '      </dl>' +
      '      <hr>' +
      '      <div class="d-flex justify-content-between align-items-baseline gap-2">' +
      '        <span class="fw-semibold">Total apurado no mes</span>' +
      '        <span class="fs-5 fw-bold ' + monthClass + '">' + Utils.formatMoney(s.month.total_value) + '</span>' +
      '      </div>' +
      (machine.notes
        ? '<hr><p class="small mb-0 text-break-anywhere"><strong>Observacoes:</strong><br>' +
          Utils.escapeHtml(machine.notes) + '</p>'
        : '') +
      '    </div></div>' +
      '  </div>' +
      '</div>' +

      '<div class="card">' +
      '  <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">' +
      '    <span>Historico de coletas</span>' +
      '    <select class="form-select form-select-sm w-auto" id="historyPeriod">' +
      '      <option value="all">Todo o periodo</option>' +
      '      <option value="month">Este mes</option>' +
      '      <option value="last_month">Mes anterior</option>' +
      '      <option value="week">Esta semana</option>' +
      '    </select>' +
      '  </div>' +
      '  <div class="card-body p-2 p-md-3">' +
      '    <div id="historyList"></div>' +
      '    <div id="historyPagination" class="mt-3"></div>' +
      '  </div>' +
      '</div>';

    document.getElementById('historyPeriod').addEventListener('change', function (e) {
      historyState.period = e.target.value;
      historyState.page = 1;
      loadHistory();
    });
  }

  function loadHistory() {
    var container = document.getElementById('historyList');
    if (!container) return;
    Utils.renderLoading(container, 4);

    Api.get('/machines/' + machineId + '/collections', {
      page: historyState.page, pageSize: historyState.pageSize, period: historyState.period
    })
      .then(function (payload) {
        renderHistory(payload.data);
        Utils.renderPagination(document.getElementById('historyPagination'), payload.pagination, function (page) {
          historyState.page = page;
          loadHistory();
        });
      })
      .catch(function (error) { Utils.renderError(container, error.message, loadHistory); });
  }

  function renderHistory(items) {
    var container = document.getElementById('historyList');

    if (!items.length) {
      Utils.renderEmpty(container, 'Nenhuma coleta neste periodo.', '&#128203;');
      return;
    }

    var rows = items.map(function (c) {
      var cancelled = c.status === 'cancelled';
      var totalClass = cancelled ? 'text-muted text-decoration-line-through'
        : (Number(c.calculated_total_value) < 0 ? 'value-negative' : 'value-positive');
      return '' +
        '<tr' + (cancelled ? ' class="table-light"' : '') + '>' +
        '  <td data-label="Data">' + Utils.formatDateTime(c.collected_at) +
        (c.is_exception ? ' <span class="badge text-bg-warning">Excecao</span>' : '') + '</td>' +
        '  <td data-label="Entrada anterior" class="text-end">' + Utils.formatMoney(c.previous_entry_value) + '</td>' +
        '  <td data-label="Entrada atual" class="text-end">' + Utils.formatMoney(c.current_entry_value) + '</td>' +
        '  <td data-label="Entrada apurada" class="text-end">' + Utils.formatMoney(c.calculated_entry_value) + '</td>' +
        '  <td data-label="Saida anterior" class="text-end">' + Utils.formatMoney(c.previous_exit_value) + '</td>' +
        '  <td data-label="Saida atual" class="text-end">' + Utils.formatMoney(c.current_exit_value) + '</td>' +
        '  <td data-label="Saida apurada" class="text-end">' + Utils.formatMoney(c.calculated_exit_value) + '</td>' +
        '  <td data-label="Apurado" class="text-end fw-semibold ' + totalClass + '">' +
        Utils.formatMoney(c.calculated_total_value) + '</td>' +
        '  <td data-label="Status">' + Utils.statusBadge(c.status) + '</td>' +
        '  <td data-label="Responsavel">' + Utils.escapeHtml(c.user_name) + '</td>' +
        '  <td data-label="" class="cell-actions text-end">' +
        '    <a class="btn btn-sm btn-outline-primary" href="/collection-detail.html?id=' + c.id + '">Detalhes</a>' +
        '  </td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-sm table-hover align-middle mb-0">' +
      '  <thead><tr>' +
      '    <th>Data</th>' +
      '    <th class="text-end">Ent. anterior</th><th class="text-end">Ent. atual</th><th class="text-end">Ent. apurada</th>' +
      '    <th class="text-end">Said. anterior</th><th class="text-end">Said. atual</th><th class="text-end">Said. apurada</th>' +
      '    <th class="text-end">Apurado</th><th>Status</th><th>Responsavel</th><th></th>' +
      '  </tr></thead>' +
      '  <tbody>' + rows + '</tbody>' +
      '</table></div>';
  }

  function infoRow(label, value) {
    return '<dt class="col-6 col-sm-5 fw-normal text-muted">' + Utils.escapeHtml(label) + '</dt>' +
      '<dd class="col-6 col-sm-7 text-end text-sm-start text-break-anywhere">' + value + '</dd>';
  }
}());
