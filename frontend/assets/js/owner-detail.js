/** Pagina do cliente: dados, resumo e maquinas. */
(function () {
  'use strict';

  var ownerId = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;
    ownerId = Utils.queryParam('id');
    if (!ownerId) {
      Utils.renderError(document.getElementById('ownerContent'), 'Cliente nao informado.');
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
          '  <td data-label="Ultimo valor bruto" class="text-end">' +
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
      '          <span class="fw-semibold">Total bruto no mes</span>' +
      '          <span class="fs-5 fw-bold ' + totalClass + '">' + Utils.formatMoney(s.total_value) + '</span>' +
      '        </div>' +
      '      </div></div>' +
      '  </div>' +
      '</div>' +

      // Documento do cliente: e a comprovacao de quem foi cadastrado, entao
      // fica na ficha, nao escondido dentro do formulario de edicao.
      '<div class="card mb-3">' +
      '  <div class="card-header">Documento do cliente</div>' +
      '  <div class="card-body">' +
      (owner.document_photo_path
        ? '<div class="d-flex flex-wrap align-items-start gap-3">' +
          '  <button type="button" class="p-0 border-0 bg-transparent" id="btnOpenDocument"' +
          '          aria-label="Ver o documento em tamanho maior">' +
          '    <img id="documentPhoto" alt="Documento de ' + Utils.escapeHtml(owner.name) + '"' +
          '         class="rounded border" style="width:180px;height:180px;object-fit:cover;cursor:zoom-in">' +
          '  </button>' +
          '  <div class="small">' +
          '    <dl class="row mb-2">' +
          infoRow('Arquivo', Utils.escapeHtml(owner.document_photo_name || 'documento')) +
          infoRow('Tamanho', owner.document_photo_size
            ? Utils.tamanhoLegivel(owner.document_photo_size) : '-') +
          infoRow('Anexado em', owner.document_photo_at
            ? Utils.formatDateTime(owner.document_photo_at) : '-') +
          '    </dl>' +
          '    <button type="button" class="btn btn-sm btn-outline-primary" id="btnDownloadDocument">' +
          'Baixar</button>' +
          '  </div>' +
          '</div>'
        : '<div class="state-block"><div class="state-icon">&#128196;</div>' +
          '<p class="mb-1">Este cliente nao tem foto de documento.</p>' +
          '<p class="text-muted small mb-0">Ele foi cadastrado antes da foto passar a ser exigida. ' +
          'Use <em>Editar</em> na lista de clientes para anexar.</p></div>') +
      '  </div>' +
      '</div>' +

      '<div class="card">' +
      '  <div class="card-header d-flex justify-content-between align-items-center">' +
      '    <span>Maquinas deste cliente</span>' +
      '    <span class="badge text-bg-secondary">' + owner.machines.length + '</span>' +
      '  </div>' +
      '  <div class="card-body p-2 p-md-3">' +
      (machinesRows
        ? '<div class="table-responsive-cards"><table class="table table-hover align-middle mb-0">' +
          '<thead><tr><th>Maquina</th><th>Status</th><th>Ultima coleta</th>' +
          '<th class="text-end">Ultimo valor bruto</th><th></th></tr></thead>' +
          '<tbody>' + machinesRows + '</tbody></table></div>'
        : '<div class="state-block"><div class="state-icon">&#127925;</div>' +
          '<p class="mb-2">Este cliente ainda nao possui maquinas.</p>' +
          '<a class="btn btn-sm btn-primary" href="/machines.html?owner_id=' + owner.id + '">Cadastrar maquina</a></div>') +
      '  </div>' +
      '</div>';

    if (owner.document_photo_path) bindDocumento(owner);
  }

  /**
   * Foto do documento.
   *
   * A imagem e protegida: o token vai no cabecalho, nunca na URL. Por isso ela
   * e baixada como blob e so entao vira o src do <img>.
   *
   * O endereco do blob fica vivo enquanto a ficha estiver aberta, porque a
   * miniatura e o modal usam o mesmo. Descartar logo depois de carregar a
   * miniatura faria a imagem do modal abrir quebrada.
   */
  var urlDocumento = null;

  function bindDocumento(owner) {
    var caminho = '/owners/' + owner.id + '/document-photo';
    var img = document.getElementById('documentPhoto');

    Api.get(caminho)
      .then(function (blob) {
        urlDocumento = URL.createObjectURL(blob);
        img.src = urlDocumento;
      })
      .catch(function () {
        img.replaceWith(Object.assign(document.createElement('p'), {
          className: 'text-muted small mb-0',
          textContent: 'Nao foi possivel carregar a foto do documento.'
        }));
      });

    document.getElementById('btnOpenDocument').addEventListener('click', function () {
      if (!urlDocumento) return;
      abrirEmTamanhoReal(owner);
    });

    document.getElementById('btnDownloadDocument').addEventListener('click', function () {
      var nome = owner.document_photo_name || ('documento-' + owner.id + '.jpg');
      Api.download(caminho, null, nome)
        .catch(function (erro) { Utils.notify.error(erro.message || 'Nao foi possivel baixar.'); });
    });

    window.addEventListener('beforeunload', function () {
      if (urlDocumento) URL.revokeObjectURL(urlDocumento);
    });
  }

  /** Abre a foto em um modal, para conferir os dados do documento. */
  function abrirEmTamanhoReal(owner) {
    var el = document.getElementById('documentModal');
    el.querySelector('[data-document-title]').textContent = 'Documento de ' + owner.name;

    var alvo = el.querySelector('[data-document-image]');
    alvo.src = urlDocumento;
    alvo.alt = 'Documento de ' + owner.name;

    bootstrap.Modal.getOrCreateInstance(el).show();
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
