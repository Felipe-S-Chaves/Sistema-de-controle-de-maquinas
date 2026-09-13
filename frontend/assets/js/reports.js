/** Relatorios com filtros, totais e exportacao em PDF. */
(function () {
  'use strict';

  var state = { type: 'period', ownerId: '', machineId: '', period: 'month', startDate: null, endDate: null };
  var lastReport = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    loadOwners();
    bindFilters();

    var presetOwner = Utils.queryParam('owner_id');
    var presetMachine = Utils.queryParam('machine_id');
    if (presetOwner || presetMachine) {
      state.ownerId = presetOwner || '';
      state.machineId = presetMachine || '';
      state.period = 'month';
      setTimeout(function () {
        if (presetOwner) document.getElementById('ownerFilter').value = presetOwner;
        generate();
      }, 500);
    }
  });

  function loadOwners() {
    Api.get('/owners', { pageSize: 100 })
      .then(function (payload) {
        document.getElementById('ownerFilter').innerHTML = '<option value="">Todos</option>' +
          payload.data.map(function (o) {
            return '<option value="' + o.id + '">' + Utils.escapeHtml(o.name) + '</option>';
          }).join('');
      })
      .catch(function () { /* filtro opcional */ });
  }

  function loadMachines(ownerId) {
    var select = document.getElementById('machineFilter');
    var request = ownerId ? Api.get('/owners/' + ownerId + '/machines') : Api.get('/machines', { pageSize: 100 });

    request.then(function (payload) {
      select.innerHTML = '<option value="">Todas</option>' +
        payload.data.map(function (m) {
          return '<option value="' + m.id + '">' + Utils.escapeHtml(m.number + ' - ' + m.name) + '</option>';
        }).join('');
    }).catch(function () { /* filtro opcional */ });
  }

  function bindFilters() {
    document.getElementById('typeSelect').addEventListener('change', function (e) { state.type = e.target.value; });
    document.getElementById('ownerFilter').addEventListener('change', function (e) {
      state.ownerId = e.target.value;
      state.machineId = '';
      loadMachines(state.ownerId);
    });
    document.getElementById('machineFilter').addEventListener('change', function (e) { state.machineId = e.target.value; });

    var periodSelect = document.getElementById('periodSelect');
    var customFields = document.querySelectorAll('[data-custom-range]');
    document.getElementById('endDate').value = Utils.todayInput();
    document.getElementById('startDate').value = Utils.todayInput().slice(0, 8) + '01';

    periodSelect.addEventListener('change', function () {
      state.period = periodSelect.value;
      customFields.forEach(function (el) { el.classList.toggle('d-none', periodSelect.value !== 'custom'); });
    });

    document.getElementById('btnGenerate').addEventListener('click', generate);
    document.getElementById('btnPdf').addEventListener('click', downloadPdf);
  }

  function params() {
    var p = {
      type: state.type,
      owner_id: state.ownerId || null,
      machine_id: state.machineId || null,
      period: state.period
    };
    if (state.period === 'custom') {
      p.start_date = document.getElementById('startDate').value;
      p.end_date = document.getElementById('endDate').value;
    }
    return p;
  }

  function endpoint() {
    if (state.type === 'owners') return '/reports/owners';
    if (state.type === 'machines') return '/reports/machines';
    return '/reports/period';
  }

  function generate() {
    if (state.period === 'custom') {
      var start = document.getElementById('startDate').value;
      var end = document.getElementById('endDate').value;
      if (!start || !end) { Utils.notify.warning('Informe a data inicial e a data final.'); return; }
      if (start > end) { Utils.notify.warning('A data inicial deve ser anterior a data final.'); return; }
    }

    var button = document.getElementById('btnGenerate');
    Utils.setButtonLoading(button, true, 'Gerando...');
    Utils.renderLoading(document.getElementById('reportContent'), 6);
    document.getElementById('btnPdf').disabled = true;

    Api.get(endpoint(), params())
      .then(function (payload) {
        lastReport = payload.data;
        renderTotals(lastReport);
        renderTable(lastReport);
        document.getElementById('btnPdf').disabled = false;
      })
      .catch(function (error) {
        document.getElementById('reportTotals').innerHTML = '';
        Utils.renderError(document.getElementById('reportContent'), error.message, generate);
      })
      .finally(function () { Utils.setButtonLoading(button, false); });
  }

  function renderTotals(report) {
    var t = report.totals;
    var totalClass = Number(t.total_value) < 0 ? 'value-negative' : 'value-positive';

    document.getElementById('reportTotals').innerHTML =
      '<div class="card-body p-3">' +
      '  <p class="metric-label mb-2">' + Utils.escapeHtml(report.period_label) +
      (report.owner ? ' - ' + Utils.escapeHtml(report.owner.name) : '') +
      (report.machine ? ' - ' + Utils.escapeHtml(report.machine.number + ' - ' + report.machine.name) : '') +
      '  </p>' +
      '  <div class="row g-2 text-center text-sm-start">' +
      block('Coletas confirmadas', t.collections_count) +
      block('Total de entradas (apurado)', Utils.formatMoney(t.total_entry)) +
      block('Total de saidas (apurado)', Utils.formatMoney(t.total_exit)) +
      block('Total apurado', Utils.formatMoney(t.total_value), totalClass) +
      '  </div>' +
      '</div>';
  }

  function block(label, value, cssClass) {
    return '<div class="col-6 col-lg-3">' +
      '<div class="metric-label">' + Utils.escapeHtml(label) + '</div>' +
      '<div class="fs-6 fw-bold ' + (cssClass || '') + '">' + value + '</div></div>';
  }

  function renderTable(report) {
    var container = document.getElementById('reportContent');

    if (!report.rows.length) {
      Utils.renderEmpty(container, 'Nenhuma coleta confirmada no periodo selecionado.', '&#128200;');
      return;
    }

    if (report.type === 'owners') return renderOwners(container, report.rows);
    if (report.type === 'machines') return renderMachines(container, report.rows);
    return renderPeriod(container, report.rows);
  }

  function renderOwners(container, rows) {
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td data-label="Proprietario"><a href="/owner-detail.html?id=' + r.id + '">' +
        Utils.escapeHtml(r.name) + '</a></td>' +
        '<td data-label="CPF/CNPJ">' + Utils.formatDocument(r.document, r.document_type) + '</td>' +
        '<td data-label="Maquinas" class="text-end">' + r.machines_total + '</td>' +
        '<td data-label="Coletas" class="text-end">' + r.collections_count + '</td>' +
        '<td data-label="Entrada apurada" class="text-end">' + Utils.formatMoney(r.total_entry) + '</td>' +
        '<td data-label="Saida apurada" class="text-end">' + Utils.formatMoney(r.total_exit) + '</td>' +
        '<td data-label="Apurado" class="text-end fw-semibold ' +
        (Number(r.total_value) < 0 ? 'value-negative' : 'value-positive') + '">' +
        Utils.formatMoney(r.total_value) + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = table(
      '<th>Proprietario</th><th>CPF/CNPJ</th><th class="text-end">Maquinas</th>' +
      '<th class="text-end">Coletas</th><th class="text-end">Entrada apurada</th>' +
      '<th class="text-end">Saida apurada</th><th class="text-end">Apurado</th>', body);
  }

  function renderMachines(container, rows) {
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td data-label="Maquina"><a href="/machine-detail.html?id=' + r.id + '">' +
        Utils.escapeHtml(r.number + ' - ' + r.name) + '</a></td>' +
        '<td data-label="Proprietario">' + Utils.escapeHtml(r.owner_name) + '</td>' +
        '<td data-label="Status">' + Utils.statusBadge(r.status) + '</td>' +
        '<td data-label="Coletas" class="text-end">' + r.collections_count + '</td>' +
        '<td data-label="Ultima coleta">' + (r.last_collection_at ? Utils.formatDate(r.last_collection_at) : '-') + '</td>' +
        '<td data-label="Entrada apurada" class="text-end">' + Utils.formatMoney(r.total_entry) + '</td>' +
        '<td data-label="Saida apurada" class="text-end">' + Utils.formatMoney(r.total_exit) + '</td>' +
        '<td data-label="Apurado" class="text-end fw-semibold ' +
        (Number(r.total_value) < 0 ? 'value-negative' : 'value-positive') + '">' +
        Utils.formatMoney(r.total_value) + '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = table(
      '<th>Maquina</th><th>Proprietario</th><th>Status</th><th class="text-end">Coletas</th>' +
      '<th>Ultima coleta</th><th class="text-end">Entrada apurada</th>' +
      '<th class="text-end">Saida apurada</th><th class="text-end">Apurado</th>', body);
  }

  function renderPeriod(container, rows) {
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td data-label="Data">' + Utils.formatDateTime(r.collected_at) +
        (r.is_exception ? ' <span class="badge text-bg-warning">Excecao</span>' : '') + '</td>' +
        '<td data-label="Maquina"><a href="/machine-detail.html?id=' + r.machine_id + '">' +
        Utils.escapeHtml(r.machine_number + ' - ' + r.machine_name) + '</a></td>' +
        '<td data-label="Proprietario">' + Utils.escapeHtml(r.owner_name) + '</td>' +
        '<td data-label="Entrada" class="text-end">' + Utils.formatMoney(r.current_entry_value) + '</td>' +
        '<td data-label="Saida" class="text-end">' + Utils.formatMoney(r.current_exit_value) + '</td>' +
        '<td data-label="Entrada apurada" class="text-end">' + Utils.formatMoney(r.calculated_entry_value) + '</td>' +
        '<td data-label="Saida apurada" class="text-end">' + Utils.formatMoney(r.calculated_exit_value) + '</td>' +
        '<td data-label="Apurado" class="text-end fw-semibold ' +
        (Number(r.calculated_total_value) < 0 ? 'value-negative' : 'value-positive') + '">' +
        Utils.formatMoney(r.calculated_total_value) + '</td>' +
        '<td data-label="Responsavel">' + Utils.escapeHtml(r.user_name) + '</td>' +
        '<td data-label="" class="cell-actions text-end">' +
        '<a class="btn btn-sm btn-outline-primary" href="/collection-detail.html?id=' + r.id + '">Ver</a></td>' +
        '</tr>';
    }).join('');

    container.innerHTML = table(
      '<th>Data</th><th>Maquina</th><th>Proprietario</th>' +
      '<th class="text-end">Entrada</th><th class="text-end">Saida</th>' +
      '<th class="text-end">Ent. apurada</th><th class="text-end">Said. apurada</th>' +
      '<th class="text-end">Apurado</th><th>Responsavel</th><th></th>', body);
  }

  function table(head, body) {
    return '<div class="table-responsive-cards">' +
      '<table class="table table-sm table-hover align-middle mb-0">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function downloadPdf() {
    var button = document.getElementById('btnPdf');
    Utils.setButtonLoading(button, true, 'Gerando PDF...');

    var stamp = new Date().toISOString().slice(0, 10);
    Api.download('/reports/pdf', params(), 'relatorio-' + state.type + '-' + stamp + '.pdf')
      .then(function () { Utils.notify.success('PDF gerado.'); })
      .catch(function (error) { Utils.notify.error(error.message || 'Nao foi possivel gerar o PDF.'); })
      .finally(function () { Utils.setButtonLoading(button, false); });
  }
}());
