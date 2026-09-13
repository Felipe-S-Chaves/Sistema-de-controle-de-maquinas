/** Listagem de coletas com filtros e totais do periodo. */
(function () {
  'use strict';

  var state = {
    page: 1, pageSize: 20, ownerId: '', machineId: '',
    status: '', period: 'all', startDate: null, endDate: null
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    loadOwners();
    bindFilters();

    var presetMachine = Utils.queryParam('machine_id');
    if (presetMachine) state.machineId = presetMachine;

    load();
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
    if (!ownerId) {
      select.innerHTML = '<option value="">Todas</option>';
      return;
    }
    Api.get('/owners/' + ownerId + '/machines')
      .then(function (payload) {
        select.innerHTML = '<option value="">Todas</option>' +
          payload.data.map(function (m) {
            return '<option value="' + m.id + '">' + Utils.escapeHtml(m.number + ' - ' + m.name) + '</option>';
          }).join('');
      })
      .catch(function () { /* filtro opcional */ });
  }

  function bindFilters() {
    document.getElementById('ownerFilter').addEventListener('change', function (e) {
      state.ownerId = e.target.value;
      state.machineId = '';
      loadMachines(state.ownerId);
      state.page = 1;
      load();
    });

    document.getElementById('machineFilter').addEventListener('change', function (e) {
      state.machineId = e.target.value; state.page = 1; load();
    });

    document.getElementById('statusFilter').addEventListener('change', function (e) {
      state.status = e.target.value; state.page = 1; load();
    });

    var periodSelect = document.getElementById('periodSelect');
    var customFields = document.querySelectorAll('[data-custom-range]');
    periodSelect.addEventListener('change', function () {
      var isCustom = periodSelect.value === 'custom';
      customFields.forEach(function (el) { el.classList.toggle('d-none', !isCustom); });
      if (!isCustom) { state.period = periodSelect.value; state.page = 1; load(); }
    });

    document.getElementById('btnApplyPeriod').addEventListener('click', function () {
      var start = document.getElementById('startDate').value;
      var end = document.getElementById('endDate').value;
      if (!start || !end) { Utils.notify.warning('Informe as duas datas.'); return; }
      if (start > end) { Utils.notify.warning('A data inicial deve ser anterior a final.'); return; }
      state.period = 'custom'; state.startDate = start; state.endDate = end; state.page = 1;
      load();
    });
  }

  function params() {
    return {
      page: state.page, pageSize: state.pageSize,
      owner_id: state.ownerId || null, machine_id: state.machineId || null,
      status: state.status || null, period: state.period,
      start_date: state.period === 'custom' ? state.startDate : null,
      end_date: state.period === 'custom' ? state.endDate : null
    };
  }

  function load() {
    var container = document.getElementById('collectionsList');
    Utils.renderLoading(container, 5);
    loadTotals();

    Api.get('/collections', params())
      .then(function (payload) {
        render(payload.data);
        Utils.renderPagination(document.getElementById('collectionsPagination'), payload.pagination, function (page) {
          state.page = page; load(); window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  function loadTotals() {
    Api.get('/reports/period', {
      owner_id: state.ownerId || null, machine_id: state.machineId || null,
      period: state.period,
      start_date: state.period === 'custom' ? state.startDate : null,
      end_date: state.period === 'custom' ? state.endDate : null
    })
      .then(function (payload) {
        var t = payload.data.totals;
        var totalClass = Number(t.total_value) < 0 ? 'value-negative' : 'value-positive';
        document.getElementById('totalsCard').innerHTML =
          '<div class="card-body p-3"><div class="row g-2 text-center text-sm-start">' +
          totalBlock('Coletas confirmadas', t.collections_count) +
          totalBlock('Entrada apurada', Utils.formatMoney(t.total_entry)) +
          totalBlock('Saida apurada', Utils.formatMoney(t.total_exit)) +
          totalBlock('Total apurado', Utils.formatMoney(t.total_value), totalClass) +
          '</div></div>';
      })
      .catch(function () { document.getElementById('totalsCard').innerHTML = ''; });
  }

  function totalBlock(label, value, cssClass) {
    return '<div class="col-6 col-lg-3">' +
      '<div class="metric-label">' + Utils.escapeHtml(label) + '</div>' +
      '<div class="fs-6 fw-bold ' + (cssClass || '') + '">' + value + '</div></div>';
  }

  function render(items) {
    var container = document.getElementById('collectionsList');

    if (!items.length) {
      Utils.renderEmpty(container, 'Nenhuma coleta encontrada com estes filtros.', '&#128203;');
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
        '  <td data-label="Proprietario"><a href="/owner-detail.html?id=' + c.owner_id + '">' +
        Utils.escapeHtml(c.owner_name) + '</a></td>' +
        '  <td data-label="Maquina"><a href="/machine-detail.html?id=' + c.machine_id + '">' +
        Utils.escapeHtml(Utils.machineLabel(c)) + '</a></td>' +
        '  <td data-label="Entrada apurada" class="text-end">' + Utils.formatMoney(c.calculated_entry_value) + '</td>' +
        '  <td data-label="Saida apurada" class="text-end">' + Utils.formatMoney(c.calculated_exit_value) + '</td>' +
        '  <td data-label="Apurado" class="text-end fw-semibold ' + totalClass + '">' +
        Utils.formatMoney(c.calculated_total_value) + '</td>' +
        '  <td data-label="Fotos" class="text-end">' + c.images_count + '</td>' +
        '  <td data-label="Status">' + Utils.statusBadge(c.status) + '</td>' +
        '  <td data-label="" class="cell-actions text-end">' +
        '    <a class="btn btn-sm btn-outline-primary" href="/collection-detail.html?id=' + c.id + '">Detalhes</a>' +
        '  </td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-hover align-middle mb-0">' +
      '  <thead><tr><th>Data</th><th>Proprietario</th><th>Maquina</th>' +
      '    <th class="text-end">Ent. apurada</th><th class="text-end">Said. apurada</th>' +
      '    <th class="text-end">Apurado</th><th class="text-end">Fotos</th><th>Status</th><th></th></tr></thead>' +
      '  <tbody>' + rows + '</tbody>' +
      '</table></div>';
  }
}());
