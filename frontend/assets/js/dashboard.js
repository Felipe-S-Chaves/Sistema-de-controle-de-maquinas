/** Dashboard: metricas, evolucao financeira e ultimas coletas. */
(function () {
  'use strict';

  var state = { period: 'month', startDate: null, endDate: null };

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    bindPeriodFilter();
    load();
  });

  function bindPeriodFilter() {
    var select = document.getElementById('periodSelect');
    var customFields = document.querySelectorAll('[data-custom-range]');
    var apply = document.getElementById('btnApplyPeriod');
    var start = document.getElementById('startDate');
    var end = document.getElementById('endDate');

    end.value = Utils.todayInput();
    start.value = Utils.todayInput().slice(0, 8) + '01';

    select.addEventListener('change', function () {
      var isCustom = select.value === 'custom';
      customFields.forEach(function (el) { el.classList.toggle('d-none', !isCustom); });
      if (!isCustom) { state.period = select.value; load(); }
    });

    apply.addEventListener('click', function () {
      if (!start.value || !end.value) {
        Utils.notify.warning('Informe a data inicial e a data final.');
        return;
      }
      if (start.value > end.value) {
        Utils.notify.warning('A data inicial deve ser anterior a data final.');
        return;
      }
      state.period = 'custom';
      state.startDate = start.value;
      state.endDate = end.value;
      load();
    });
  }

  function load() {
    renderMetricsSkeleton();
    Utils.renderLoading(document.getElementById('latestCollections'), 3);

    Api.get('/dashboard', {
      period: state.period,
      start_date: state.period === 'custom' ? state.startDate : null,
      end_date: state.period === 'custom' ? state.endDate : null
    })
      .then(function (payload) {
        var data = payload.data;
        document.getElementById('periodLabel').textContent = 'Periodo: ' + data.metrics.period_label;
        renderMetrics(data.metrics);
        renderFinancialSummary(data.metrics);
        renderChart(data.monthly_series);
        renderLatest(data.latest_collections);
      })
      .catch(function (error) {
        Utils.renderError(document.getElementById('metricsRow'), error.message, load);
        Utils.renderError(document.getElementById('latestCollections'), error.message, load);
      });
  }

  function renderMetricsSkeleton() {
    var row = document.getElementById('metricsRow');
    var html = '';
    for (var i = 0; i < 6; i += 1) {
      html += '<div class="col-6 col-md-4 col-xl-2"><div class="skeleton" style="height:92px"></div></div>';
    }
    row.innerHTML = html;
  }

  function metricCard(label, value, icon, valueClass) {
    return '' +
      '<div class="col-6 col-md-4 col-xl-2">' +
      '  <div class="card metric-card">' +
      '    <div class="card-body p-3 d-flex align-items-start gap-2">' +
      '      <div class="metric-icon" aria-hidden="true">' + icon + '</div>' +
      '      <div class="min-w-0 flex-grow-1">' +
      '        <div class="metric-label">' + Utils.escapeHtml(label) + '</div>' +
      '        <div class="metric-value ' + (valueClass || '') + '">' + value + '</div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  function renderMetrics(m) {
    var totalClass = Number(m.total_value) < 0 ? 'value-negative' : 'value-positive';
    document.getElementById('metricsRow').innerHTML =
      metricCard('Proprietarios', m.owners_total, '&#128100;') +
      metricCard('Maquinas', m.machines_total, '&#127925;') +
      metricCard('Maquinas ativas', m.machines_active, '&#9989;') +
      metricCard('Em manutencao', m.machines_maintenance, '&#128295;') +
      metricCard('Coletas no periodo', m.collections_count, '&#128203;') +
      metricCard('Valor apurado', Utils.formatMoney(m.total_value), '&#128176;', totalClass + ' is-long');
  }

  function renderFinancialSummary(m) {
    var totalClass = Number(m.total_value) < 0 ? 'value-negative' : 'value-positive';
    document.getElementById('financialSummary').innerHTML =
      '<dl class="row mb-0">' +
      '  <dt class="col-7 fw-normal text-muted">Entrada apurada</dt>' +
      '  <dd class="col-5 text-end fw-semibold">' + Utils.formatMoney(m.total_entry) + '</dd>' +
      '  <dt class="col-7 fw-normal text-muted">Saida apurada</dt>' +
      '  <dd class="col-5 text-end fw-semibold">' + Utils.formatMoney(m.total_exit) + '</dd>' +
      '  <dt class="col-7 fw-normal text-muted">Coletas confirmadas</dt>' +
      '  <dd class="col-5 text-end fw-semibold">' + m.collections_count + '</dd>' +
      '  <dt class="col-7 fw-normal text-muted">Coletas canceladas</dt>' +
      '  <dd class="col-5 text-end fw-semibold">' + m.collections_cancelled + '</dd>' +
      '</dl>' +
      '<hr>' +
      '<div class="d-flex justify-content-between align-items-baseline gap-2">' +
      '  <span class="fw-semibold">Total apurado</span>' +
      '  <span class="fs-5 fw-bold ' + totalClass + '">' + Utils.formatMoney(m.total_value) + '</span>' +
      '</div>' +
      '<p class="text-muted small mb-0 mt-2">Apurado = entrada apurada &minus; saida apurada. ' +
      'Coletas canceladas nao entram nos totais.</p>';
  }

  /**
   * Grafico de barras em SVG puro (sem biblioteca externa).
   * Responsivo por viewBox: nunca ultrapassa a largura do cartao.
   */
  function renderChart(series) {
    var wrap = document.getElementById('chartWrap');

    if (!series || !series.length) {
      Utils.renderEmpty(wrap, 'Ainda nao ha coletas confirmadas para montar o grafico.', '&#128200;');
      return;
    }

    var width = 640;
    var height = 260;
    var padding = { top: 18, right: 12, bottom: 42, left: 62 };
    var innerW = width - padding.left - padding.right;
    var innerH = height - padding.top - padding.bottom;

    var values = series.map(function (s) { return Number(s.total_value); });
    var maxValue = Math.max.apply(null, values.concat([0]));
    var minValue = Math.min.apply(null, values.concat([0]));
    var range = (maxValue - minValue) || 1;

    var barGap = 10;
    var slot = innerW / series.length;
    var barWidth = Math.min(72, Math.max(10, slot - barGap));   // barra unica nao vira um bloco gigante
    var zeroY = padding.top + innerH * (maxValue / range);

    var svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" ' +
      'aria-label="Evolucao do valor apurado por mes" style="width:100%;height:auto;display:block">';

    // Linhas de grade
    for (var g = 0; g <= 4; g += 1) {
      var gy = padding.top + (innerH / 4) * g;
      var gValue = maxValue - (range / 4) * g;
      svg += '<line x1="' + padding.left + '" y1="' + gy + '" x2="' + (width - padding.right) + '" y2="' + gy +
        '" stroke="#e6eaf0" stroke-width="1"/>';
      svg += '<text x="' + (padding.left - 6) + '" y="' + (gy + 4) + '" text-anchor="end" ' +
        'font-size="10" fill="#6b7280">' + shortMoney(gValue) + '</text>';
    }

    series.forEach(function (item, index) {
      var value = Number(item.total_value);
      var x = padding.left + slot * index + (slot - barWidth) / 2;
      var barHeight = Math.abs(value) / range * innerH;
      var y = value >= 0 ? zeroY - barHeight : zeroY;
      var color = value >= 0 ? '#1f3a5f' : '#b91c1c';

      svg += '<rect x="' + x + '" y="' + y + '" width="' + barWidth + '" height="' + Math.max(barHeight, 1) +
        '" rx="3" fill="' + color + '"><title>' +
        Utils.escapeHtml(formatPeriod(item.period) + ': ' + Utils.formatMoney(item.total_value) +
          ' (' + item.collections_count + ' coleta(s))') + '</title></rect>';

      svg += '<text x="' + (x + barWidth / 2) + '" y="' + (height - 24) + '" text-anchor="middle" ' +
        'font-size="10" fill="#46505c">' + formatPeriod(item.period) + '</text>';
      svg += '<text x="' + (x + barWidth / 2) + '" y="' + (height - 10) + '" text-anchor="middle" ' +
        'font-size="9" fill="#9aa3af">' + item.collections_count + ' col.</text>';
    });

    svg += '<line x1="' + padding.left + '" y1="' + zeroY + '" x2="' + (width - padding.right) + '" y2="' + zeroY +
      '" stroke="#9aa3af" stroke-width="1"/>';
    svg += '</svg>';

    wrap.innerHTML = svg;
  }

  function shortMoney(value) {
    var abs = Math.abs(value);
    if (abs >= 1000000) return (value / 1000000).toFixed(1).replace('.', ',') + 'M';
    if (abs >= 1000) return (value / 1000).toFixed(1).replace('.', ',') + 'k';
    return value.toFixed(0);
  }

  function formatPeriod(period) {
    var months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    var parts = String(period).split('-');
    return months[Number(parts[1]) - 1] + '/' + parts[0].slice(2);
  }

  function renderLatest(items) {
    var container = document.getElementById('latestCollections');

    if (!items || !items.length) {
      Utils.renderEmpty(container, 'Nenhuma coleta registrada ate o momento.', '&#128203;');
      return;
    }

    var rows = items.map(function (c) {
      var totalClass = Number(c.calculated_total_value) < 0 ? 'value-negative' : 'value-positive';
      return '' +
        '<tr>' +
        '  <td data-label="Data">' + Utils.formatDateTime(c.collected_at) + '</td>' +
        '  <td data-label="Proprietario"><a href="/owner-detail.html?id=' + c.owner_id + '">' +
        Utils.escapeHtml(c.owner_name) + '</a></td>' +
        '  <td data-label="Maquina">' + Utils.escapeHtml(Utils.machineLabel(c)) + '</td>' +
        '  <td data-label="Entrada" class="text-end">' + Utils.formatMoney(c.current_entry_value) + '</td>' +
        '  <td data-label="Saida" class="text-end">' + Utils.formatMoney(c.current_exit_value) + '</td>' +
        '  <td data-label="Apurado" class="text-end fw-semibold ' + totalClass + '">' +
        Utils.formatMoney(c.calculated_total_value) + '</td>' +
        '  <td data-label="Status">' + Utils.statusBadge(c.status) + '</td>' +
        '  <td data-label="" class="cell-actions text-end">' +
        '    <a class="btn btn-sm btn-outline-primary" href="/collection-detail.html?id=' + c.id + '">Detalhes</a>' +
        '  </td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-hover align-middle mb-0">' +
      '  <thead><tr>' +
      '    <th>Data</th><th>Proprietario</th><th>Maquina</th>' +
      '    <th class="text-end">Entrada</th><th class="text-end">Saida</th>' +
      '    <th class="text-end">Apurado</th><th>Status</th><th></th>' +
      '  </tr></thead>' +
      '  <tbody>' + rows + '</tbody>' +
      '</table></div>';
  }
}());
