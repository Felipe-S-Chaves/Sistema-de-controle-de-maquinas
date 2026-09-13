/** Pagina do proprietario: dados, resumo e maquinas. */
(function () {
  'use strict';

  var ownerId = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;
    ownerId = Utils.queryParam('id');
    if (!ownerId) {
      Utils.renderError(document.getElementById('ownerContent'), 'Proprietario nao informado.');
      return;
    }
    load();
  });

  function load() {
    var container = document.getElementById('ownerContent');
    Utils.renderLoading(container, 6);

    Api.get('/owners/' + ownerId, { period: 'month' })
      .then(function (payload) { render(payload.data); })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  function render(owner) {
    document.getElementById('crumbName').textContent = owner.name;
    document.title = owner.name + ' - Controle de Maquinas';

    var s = owner.summary;
    var totalClass = Number(s.total_value) < 0 ? 'value-negative' : 'value-positive';

    var machinesRows = owner.machines.length
      ? owner.machines.map(function (m) {
        return '' +
          '<tr>' +
          '  <td data-label="Maquina"><a href="/machine-detail.html?id=' + m.id + '" class="fw-semibold">' +
          Utils.escapeHtml(m.number + ' - ' + m.name) + '</a></td>' +
          '  <td data-label="Status">' + Utils.statusBadge(m.status) + '</td>' +
          '  <td data-label="Ultima coleta">' +
          (m.last_collection_at ? Utils.formatDateTime(m.last_collection_at) : 'Sem coletas') + '</td>' +
          '  <td data-label="Ultimo apurado" class="text-end">' +
          (m.last_total_value !== null ? Utils.formatMoney(m.last_total_value) : '-') + '</td>' +
          '  <td data-label="" class="cell-actions text-end">' +
          '    <a class="btn btn-sm btn-outline-primary" href="/collection-new.html?machine_id=' + m.id + '">Coletar</a>' +
          '  </td>' +
          '</tr>';
      }).join('')
      : '';

    document.getElementById('ownerContent').innerHTML =
      '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">' +
      '  <div class="min-w-0">' +
      '    <h1 class="h4 mb-1 text-break-anywhere">' + Utils.escapeHtml(owner.name) + '</h1>' +
      '    <div>' + Utils.statusBadge(owner.status, true) + '</div>' +
      '  </div>' +
      '  <div class="d-flex gap-2 flex-wrap">' +
      '    <a class="btn btn-outline-primary btn-touch" href="/machines.html?owner_id=' + owner.id + '">Maquinas</a>' +
      '    <a class="btn btn-outline-primary btn-touch" href="/reports.html?owner_id=' + owner.id + '">Relatorio</a>' +
      '  </div>' +
      '</div>' +

      '<div class="row g-3 mb-3">' +
      '  <div class="col-12 col-lg-6">' +
      '    <div class="card h-100"><div class="card-header">Informacoes</div>' +
      '      <div class="card-body">' +
      '        <dl class="row mb-0 small">' +
      infoRow('CPF/CNPJ', Utils.formatDocument(owner.document, owner.document_type)) +
      infoRow('Telefone', Utils.formatPhone(owner.phone)) +
      infoRow('WhatsApp', Utils.formatPhone(owner.whatsapp)) +
      infoRow('E-mail', owner.email || '-') +
      infoRow('Endereco', [owner.address, owner.city, owner.state].filter(Boolean).join(', ') || '-') +
      infoRow('CEP', owner.zip_code || '-') +
      infoRow('Cadastrado em', Utils.formatDate(owner.created_at)) +
      '        </dl>' +
      (owner.notes
        ? '<hr><p class="small mb-0 text-break-anywhere"><strong>Observacoes:</strong><br>' +
          Utils.escapeHtml(owner.notes) + '</p>'
        : '') +
      '      </div></div>' +
      '  </div>' +

      '  <div class="col-12 col-lg-6">' +
      '    <div class="card h-100"><div class="card-header">Resumo (este mes)</div>' +
      '      <div class="card-body">' +
      '        <div class="row g-2 mb-3">' +
      miniStat('Maquinas', s.machines_total) +
      miniStat('Ativas', s.machines_active) +
      miniStat('Manutencao', s.machines_maintenance) +
      miniStat('Coletas', s.collections_count) +
      '        </div>' +
      '        <dl class="row mb-0 small">' +
      infoRow('Entrada apurada', Utils.formatMoney(s.total_entry)) +
      infoRow('Saida apurada', Utils.formatMoney(s.total_exit)) +
      infoRow('Ultima coleta', s.last_collection
        ? Utils.formatDateTime(s.last_collection.collected_at) +
          ' (' + Utils.escapeHtml(s.last_collection.number + ' - ' + s.last_collection.name) + ')'
        : 'Sem coletas') +
      '        </dl>' +
      '        <hr>' +
      '        <div class="d-flex justify-content-between align-items-baseline gap-2">' +
      '          <span class="fw-semibold">Total apurado no mes</span>' +
      '          <span class="fs-5 fw-bold ' + totalClass + '">' + Utils.formatMoney(s.total_value) + '</span>' +
      '        </div>' +
      '      </div></div>' +
      '  </div>' +
      '</div>' +

      '<div class="card">' +
      '  <div class="card-header d-flex justify-content-between align-items-center">' +
      '    <span>Maquinas deste proprietario</span>' +
      '    <span class="badge text-bg-secondary">' + owner.machines.length + '</span>' +
      '  </div>' +
      '  <div class="card-body p-2 p-md-3">' +
      (machinesRows
        ? '<div class="table-responsive-cards"><table class="table table-hover align-middle mb-0">' +
          '<thead><tr><th>Maquina</th><th>Status</th><th>Ultima coleta</th>' +
          '<th class="text-end">Ultimo apurado</th><th></th></tr></thead>' +
          '<tbody>' + machinesRows + '</tbody></table></div>'
        : '<div class="state-block"><div class="state-icon">&#127925;</div>' +
          '<p class="mb-2">Este proprietario ainda nao possui maquinas.</p>' +
          '<a class="btn btn-sm btn-primary" href="/machines.html?owner_id=' + owner.id + '">Cadastrar maquina</a></div>') +
      '  </div>' +
      '</div>';
  }

  function infoRow(label, value) {
    return '<dt class="col-5 col-sm-4 fw-normal text-muted">' + Utils.escapeHtml(label) + '</dt>' +
      '<dd class="col-7 col-sm-8 text-break-anywhere">' + value + '</dd>';
  }

  function miniStat(label, value) {
    return '<div class="col-6 col-sm-3"><div class="reading-box py-2">' +
      '<div class="reading-label">' + Utils.escapeHtml(label) + '</div>' +
      '<div class="fw-bold">' + value + '</div></div></div>';
  }
}());
