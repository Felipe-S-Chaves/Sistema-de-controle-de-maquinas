/**
 * Relatorio de coletas: um so tipo, analitico, coleta a coleta.
 *
 * O recorte e feito por clique - cliente e maquinas - porque a tela e
 * usada no celular, onde marcar sete maquinas em um dropdown e sofrimento.
 * O periodo continua em lista, que e onde o dropdown ainda funciona bem.
 *
 * Nenhuma maquina marcada significa "todas do recorte atual", nao "nenhuma":
 * e o comportamento que as pessoas esperam de um filtro vazio.
 */
(function () {
  'use strict';

  var state = {
    ownerId: '',
    machineIds: [],
    period: 'month'
  };

  var owners = [];
  var machines = [];
  var lastReport = null;

  // Quem nao ve os relatorios do negocio usa a tela no modo "minhas coletas".
  var apenasProprias = !Api.can('reports.view');

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    bindPeriod();
    document.getElementById('btnGenerate').addEventListener('click', generate);
    document.getElementById('btnPdf').addEventListener('click', downloadPdf);

    if (apenasProprias) {
      prepararModoProprio();
      generate();
      return;
    }

    bindPickers();

    var presetOwner = Utils.queryParam('owner_id');
    var presetMachine = Utils.queryParam('machine_id');
    state.ownerId = presetOwner || '';
    if (presetMachine) state.machineIds = [String(presetMachine)];

    carregarClientes().then(function () {
      return carregarMaquinas();
    }).then(function () {
      if (presetOwner || presetMachine) generate();
    });
  });

  // ---------------------------------------------------------------
  // Selecao por clique
  // ---------------------------------------------------------------

  function bindPickers() {
    document.getElementById('ownerSearch').addEventListener('input', Utils.debounce(function (e) {
      renderOwnerPick(e.target.value.trim().toLowerCase());
    }, 200));

    document.getElementById('btnPickAll').addEventListener('click', function () {
      state.machineIds = machines.map(function (m) { return String(m.id); });
      renderMachinePick();
    });

    document.getElementById('btnPickNone').addEventListener('click', function () {
      state.machineIds = [];
      renderMachinePick();
    });
  }

  function carregarClientes() {
    return Api.get('/owners', { pageSize: 200 })
      .then(function (payload) {
        owners = payload.data;
        renderOwnerPick('');
      })
      .catch(function () {
        document.getElementById('ownerPick').innerHTML =
          '<span class="pick-empty">Nao foi possivel carregar os clientes.</span>';
      });
  }

  /**
   * Maquinas do recorte atual. Ao trocar de cliente, a selecao anterior
   * e podada: manter maquinas que sumiram da lista produziria um relatorio
   * diferente do que esta na tela.
   */
  function carregarMaquinas() {
    var container = document.getElementById('machinePick');
    container.innerHTML = '<span class="pick-empty">Carregando...</span>';

    var requisicao = state.ownerId
      ? Api.get('/owners/' + state.ownerId + '/machines')
      : Api.get('/machines', { pageSize: 300 });

    return requisicao
      .then(function (payload) {
        machines = payload.data;
        var validos = machines.map(function (m) { return String(m.id); });
        state.machineIds = state.machineIds.filter(function (id) {
          return validos.indexOf(id) !== -1;
        });
        renderMachinePick();
      })
      .catch(function () {
        machines = [];
        container.innerHTML = '<span class="pick-empty">Nao foi possivel carregar as maquinas.</span>';
      });
  }

  function botao(id, rotulo, selecionado) {
    return '<button type="button" class="pick-item" data-pick="' + Utils.escapeHtml(id) + '"' +
      ' aria-pressed="' + (selecionado ? 'true' : 'false') + '">' +
      Utils.escapeHtml(rotulo) + '</button>';
  }

  function renderOwnerPick(termo) {
    var container = document.getElementById('ownerPick');
    var lista = termo
      ? owners.filter(function (o) { return o.name.toLowerCase().indexOf(termo) !== -1; })
      : owners;

    var html = botao('', 'Todos', state.ownerId === '');
    html += lista.map(function (o) {
      return botao(String(o.id), o.name, String(o.id) === String(state.ownerId));
    }).join('');

    if (!lista.length && termo) {
      html += '<span class="pick-empty">Nenhum cliente com "' + Utils.escapeHtml(termo) + '".</span>';
    }

    container.innerHTML = html;

    container.querySelectorAll('[data-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.ownerId = btn.getAttribute('data-pick');
        renderOwnerPick(termo);
        carregarMaquinas();
      });
    });
  }

  function renderMachinePick() {
    var container = document.getElementById('machinePick');

    if (!machines.length) {
      container.innerHTML = '<span class="pick-empty">' +
        (state.ownerId ? 'Este cliente nao tem maquinas cadastradas.' : 'Nenhuma maquina cadastrada.') +
        '</span>';
      atualizarContador();
      return;
    }

    container.innerHTML = machines.map(function (m) {
      return botao(String(m.id), m.number + ' - ' + m.name,
        state.machineIds.indexOf(String(m.id)) !== -1);
    }).join('');

    container.querySelectorAll('[data-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-pick');
        var pos = state.machineIds.indexOf(id);
        if (pos === -1) state.machineIds.push(id); else state.machineIds.splice(pos, 1);
        btn.setAttribute('aria-pressed', pos === -1 ? 'true' : 'false');
        atualizarContador();
      });
    });

    atualizarContador();
  }

  function atualizarContador() {
    var badge = document.getElementById('machineCount');
    if (!badge) return;
    badge.textContent = state.machineIds.length
      ? state.machineIds.length + ' selecionada(s)'
      : 'Todas';
  }

  // ---------------------------------------------------------------
  // Periodo e requisicao
  // ---------------------------------------------------------------

  function bindPeriod() {
    var periodSelect = document.getElementById('periodSelect');
    var customFields = document.querySelectorAll('[data-custom-range]');

    document.getElementById('endDate').value = Utils.todayInput();
    document.getElementById('startDate').value = Utils.todayInput().slice(0, 8) + '01';

    periodSelect.addEventListener('change', function () {
      state.period = periodSelect.value;
      customFields.forEach(function (el) { el.classList.toggle('d-none', periodSelect.value !== 'custom'); });
    });
  }

  function params() {
    var p = { period: state.period };

    if (!apenasProprias) {
      p.owner_id = state.ownerId || null;
      p.machine_ids = state.machineIds.length ? state.machineIds.join(',') : null;
    }
    if (state.period === 'custom') {
      p.start_date = document.getElementById('startDate').value;
      p.end_date = document.getElementById('endDate').value;
    }
    return p;
  }

  /**
   * Ajusta a tela para o operador: some com os filtros que ele nao pode usar
   * e deixa claro que o relatorio cobre apenas o trabalho dele.
   */
  function prepararModoProprio() {
    document.querySelector('h1').textContent = 'Minhas coletas';
    document.querySelector('h1').nextElementSibling.textContent =
      'Relatorio das coletas que voce registrou. Somente coletas confirmadas entram nos totais.';

    ['[data-filter-owner]', '[data-filter-machines]'].forEach(function (seletor) {
      var bloco = document.querySelector(seletor);
      if (bloco) bloco.classList.add('d-none');
    });
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

    Api.get(apenasProprias ? '/reports/own' : '/reports/period', params())
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

  // ---------------------------------------------------------------
  // Saida
  // ---------------------------------------------------------------

  /** Descreve o recorte no topo dos totais, sem depender do que esta na tela. */
  function legenda(report) {
    var partes = [report.period_label];

    if (report.scope === 'own') {
      partes.push(report.operator || 'minhas coletas');
    } else {
      partes.push(report.owner ? report.owner.name : 'todos os clientes');
      var m = report.machines || [];
      if (m.length === 1) partes.push(m[0].number + ' - ' + m[0].name);
      else if (m.length) partes.push(m.length + ' maquinas selecionadas');
      else partes.push('todas as maquinas');
    }

    return partes.join(' - ');
  }

  function renderTotals(report) {
    var t = report.totals;
    var totalClass = Number(t.total_value) < 0 ? 'value-negative' : 'value-positive';

    document.getElementById('reportTotals').innerHTML =
      '<div class="card-body p-3">' +
      '  <p class="metric-label mb-2">' + Utils.escapeHtml(legenda(report)) + '</p>' +
      '  <div class="row g-2 text-center text-sm-start">' +
      block('Coletas confirmadas', t.collections_count) +
      block('Total de entradas apuradas', Utils.formatMoney(t.total_entry)) +
      block('Total de saidas apuradas', Utils.formatMoney(t.total_exit)) +
      block('Total bruto', Utils.formatMoney(t.total_value), totalClass, 'bruto') +
      '  </div>' +
      '  <hr class="my-3">' +
      '  <div class="d-flex flex-wrap justify-content-between align-items-baseline gap-2">' +
      '    <span class="fw-semibold">Valor para cada' +
      '      <span class="text-muted fw-normal small">(metade do total bruto)</span></span>' +
      '    <span class="fs-4 fw-bold ' + totalClass + '" data-total="cada">' +
      Utils.formatMoney(t.total_value_half) + '</span>' +
      '  </div>' +
      '</div>';
  }

  function block(label, value, cssClass, marcador) {
    return '<div class="col-6 col-lg-3">' +
      '<div class="metric-label">' + Utils.escapeHtml(label) + '</div>' +
      '<div class="fs-6 fw-bold ' + (cssClass || '') + '"' +
      (marcador ? ' data-total="' + marcador + '"' : '') + '>' + value + '</div></div>';
  }

  /**
   * Uma linha por coleta, na ordem em que a historia aconteceu:
   * quando, em que maquina, como estavam os relogios, como estao e quanto deu.
   */
  function renderTable(report) {
    var container = document.getElementById('reportContent');

    if (!report.rows.length) {
      Utils.renderEmpty(container, 'Nenhuma coleta confirmada no periodo selecionado.', '&#128200;');
      return;
    }

    var body = report.rows.map(function (r) {
      return '<tr>' +
        '<td data-label="Data" class="text-nowrap">' + Utils.formatDateTime(r.collected_at) +
        (r.is_exception ? ' <span class="badge text-bg-warning">Excecao</span>' : '') + '</td>' +
        '<td data-label="Maquina"><a href="/machine-detail.html?id=' + r.machine_id + '">' +
        Utils.escapeHtml(r.machine_number + ' - ' + r.machine_name) + '</a></td>' +
        '<td data-label="Cliente">' + Utils.escapeHtml(r.owner_name) + '</td>' +
        '<td data-label="Ultima entrada" class="text-end text-muted">' +
        Utils.formatMoney(r.previous_entry_value) + '</td>' +
        '<td data-label="Ultima saida" class="text-end text-muted">' +
        Utils.formatMoney(r.previous_exit_value) + '</td>' +
        '<td data-label="Entrada atual" class="text-end">' +
        Utils.formatMoney(r.current_entry_value) + '</td>' +
        '<td data-label="Saida atual" class="text-end">' +
        Utils.formatMoney(r.current_exit_value) + '</td>' +
        '<td data-label="Valor bruto" class="text-end fw-semibold ' +
        (Number(r.calculated_total_value) < 0 ? 'value-negative' : 'value-positive') + '">' +
        Utils.formatMoney(r.calculated_total_value) + '</td>' +
        '<td data-label="Para cada" class="text-end ' +
        (Number(r.calculated_total_value) < 0 ? 'value-negative' : 'value-positive') + '">' +
        Utils.centsToMoney(Utils.metade(r.calculated_total_value)) + '</td>' +
        '<td data-label="Responsavel">' + Utils.escapeHtml(r.user_name) + '</td>' +
        '<td data-label="" class="cell-actions text-end">' +
        '<a class="btn btn-sm btn-outline-primary" href="/collection-detail.html?id=' + r.id + '">Ver</a></td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-sm table-hover table-wide align-middle mb-0">' +
      '<thead><tr>' +
      '<th>Data</th><th>Maquina</th><th>Cliente</th>' +
      '<th class="text-end">Ultima entrada</th><th class="text-end">Ultima saida</th>' +
      '<th class="text-end">Entrada atual</th><th class="text-end">Saida atual</th>' +
      '<th class="text-end">Valor bruto</th><th class="text-end">Para cada</th>' +
      '<th>Responsavel</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function downloadPdf() {
    var button = document.getElementById('btnPdf');
    Utils.setButtonLoading(button, true, 'Gerando PDF...');

    var stamp = new Date().toISOString().slice(0, 10);
    var rota = apenasProprias ? '/reports/own/pdf' : '/reports/pdf';
    var nome = (apenasProprias ? 'minhas-coletas-' : 'relatorio-coletas-') + stamp + '.pdf';

    Api.download(rota, params(), nome)
      .then(function () { Utils.notify.success('PDF gerado.'); })
      .catch(function (error) { Utils.notify.error(error.message || 'Nao foi possivel gerar o PDF.'); })
      .finally(function () { Utils.setButtonLoading(button, false); });
  }
}());
