/** Detalhe da coleta: valores, comprovantes e cancelamento. */
(function () {
  'use strict';

  var collectionId = null;
  var currentImages = [];

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;
    collectionId = Utils.queryParam('id');
    if (!collectionId) {
      Utils.renderError(document.getElementById('collectionContent'), 'Coleta nao informada.');
      return;
    }
    if (Utils.queryParam('created')) Utils.notify.success('Coleta registrada com sucesso.');
    load();
  });

  function load() {
    var container = document.getElementById('collectionContent');
    Utils.renderLoading(container, 6);

    Api.get('/collections/' + collectionId)
      .then(function (payload) { render(payload.data); })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  function render(c) {
    currentImages = c.images || [];
    var cancelled = c.status === 'cancelled';
    var totalClass = Number(c.calculated_total_value) < 0 ? 'value-negative' : 'value-positive';
    var machineLabel = c.machine_number + ' - ' + c.machine_name;

    document.title = 'Coleta #' + c.id + ' - Controle de Maquinas';

    document.getElementById('collectionContent').innerHTML =
      '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">' +
      '  <div class="min-w-0">' +
      '    <h1 class="h4 mb-1">Coleta #' + c.id + '</h1>' +
      '    <div class="d-flex gap-2 flex-wrap align-items-center">' + Utils.statusBadge(c.status) +
      (c.is_exception ? '<span class="badge text-bg-warning badge-status">Excecao de leitura</span>' : '') +
      (c.is_first_collection ? '<span class="badge text-bg-info badge-status">Primeira coleta</span>' : '') +
      '    </div>' +
      '  </div>' +
      '  <div class="d-flex gap-2 flex-wrap">' +
      (Api.can('collections.receipt')
        ? '    <button class="btn btn-primary btn-touch" id="btnReceipt">' +
          '<span aria-hidden="true">&#128196;</span> Comprovante em PDF</button>'
        : '') +
      (cancelled || !Api.can('collections.cancel') ? '' :
        '    <button class="btn btn-outline-danger btn-touch" id="btnCancelCollection">Cancelar coleta</button>') +
      '  </div>' +
      '</div>' +

      (cancelled
        ? '<div class="alert alert-danger">' +
          '<p class="fw-semibold mb-1">Coleta cancelada em ' + Utils.formatDateTime(c.cancelled_at) +
          (c.cancelled_by_name ? ' por ' + Utils.escapeHtml(c.cancelled_by_name) : '') + '.</p>' +
          '<p class="mb-0 small text-break-anywhere"><strong>Motivo:</strong> ' +
          Utils.escapeHtml(c.cancellation_reason || '-') + '</p>' +
          '<p class="mb-0 small mt-2">Este registro permanece no historico, mas nao entra nos totais financeiros.</p>' +
          '</div>'
        : '') +

      '<div class="row g-3 mb-3">' +
      '  <div class="col-12 col-lg-6">' +
      '    <div class="card h-100"><div class="card-header">Informacoes</div><div class="card-body">' +
      '      <dl class="row mb-0 small">' +
      infoRow('Cliente', '<a href="/owner-detail.html?id=' + c.owner_id + '">' +
        Utils.escapeHtml(c.owner_name) + '</a>') +
      infoRow('Maquina', '<a href="/machine-detail.html?id=' + c.machine_id + '">' +
        Utils.escapeHtml(machineLabel) + '</a>') +
      infoRow('Data', Utils.formatDate(c.collected_at)) +
      infoRow('Hora', new Date(c.collected_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) +
      infoRow('Usuario responsavel', Utils.escapeHtml(c.user_name)) +
      infoRow('Registrado em', Utils.formatDateTime(c.created_at)) +
      '      </dl>' +
      (c.is_exception && c.exception_reason
        ? '<hr><div class="alert alert-warning py-2 px-3 mb-0 small text-break-anywhere">' +
          '<strong>Motivo da excecao:</strong><br>' + Utils.escapeHtml(c.exception_reason) + '</div>'
        : '') +
      '    </div></div>' +
      '  </div>' +

      '  <div class="col-12 col-lg-6">' +
      '    <div class="card h-100"><div class="card-header">Valores</div><div class="card-body">' +
      '      <div class="row g-2 mb-3">' +
      '        <div class="col-12"><div class="reading-box">' +
      '          <div class="reading-label mb-1">Entrada</div>' +
      '          <dl class="row mb-0 small">' +
      valueRow('Anterior', Utils.formatMoney(c.previous_entry_value)) +
      valueRow('Atual', Utils.formatMoney(c.current_entry_value)) +
      valueRow('Apurado', '<strong>' + Utils.formatMoney(c.calculated_entry_value) + '</strong>') +
      '          </dl>' +
      '        </div></div>' +
      '        <div class="col-12"><div class="reading-box">' +
      '          <div class="reading-label mb-1">Saida</div>' +
      '          <dl class="row mb-0 small">' +
      valueRow('Anterior', Utils.formatMoney(c.previous_exit_value)) +
      valueRow('Atual', Utils.formatMoney(c.current_exit_value)) +
      valueRow('Apurado', '<strong>' + Utils.formatMoney(c.calculated_exit_value) + '</strong>') +
      '          </dl>' +
      '        </div></div>' +
      '      </div>' +
      '      <div class="result-box">' +
      '        <div class="result-line">Valor bruto</div>' +
      '        <div class="result-value">' + Utils.formatMoney(c.calculated_total_value) + '</div>' +
      '        <div class="result-line mt-2">' +
      Utils.formatMoney(c.calculated_entry_value) + ' &minus; ' + Utils.formatMoney(c.calculated_exit_value) +
      '        </div>' +
      '      </div>' +
      '    </div></div>' +
      '  </div>' +
      '</div>' +

      (c.observation
        ? '<div class="card mb-3"><div class="card-header">Observacoes</div>' +
          '<div class="card-body"><p class="mb-0 text-break-anywhere">' +
          Utils.escapeHtml(c.observation) + '</p></div></div>'
        : '') +

      '<div class="card">' +
      '  <div class="card-header d-flex justify-content-between align-items-center">' +
      '    <span>Comprovantes</span>' +
      '    <span class="badge text-bg-secondary">' + currentImages.length + '</span>' +
      '  </div>' +
      '  <div class="card-body">' +
      (currentImages.length
        ? '<div class="photo-grid" id="imageGallery">' +
          currentImages.map(function (img, index) {
            return '<button type="button" class="photo-thumb p-0 border-0" data-image-index="' + index + '" ' +
              'aria-label="Ver comprovante ' + (index + 1) + '">' +
              '<img data-image-id="' + img.id + '" alt="Comprovante ' + (index + 1) + '"></button>';
          }).join('') + '</div>'
        : '<div class="state-block"><div class="state-icon">&#128247;</div>' +
          '<p class="mb-0">Nenhuma imagem anexada.</p></div>') +
      '  </div>' +
      '</div>';

    if (currentImages.length) loadThumbnails();
    var btnCancelar = document.getElementById('btnCancelCollection');
    if (btnCancelar) btnCancelar.addEventListener('click', onCancel);

    var btnComprovante = document.getElementById('btnReceipt');
    if (btnComprovante) {
      btnComprovante.addEventListener('click', function () {
        Utils.setButtonLoading(btnComprovante, true, 'Gerando...');
        Api.downloadReceipt(collectionId)
          .then(function () { Utils.notify.success('Comprovante gerado.'); })
          .catch(function (error) {
            Utils.notify.error(error.message || 'Nao foi possivel gerar o comprovante.');
          })
          .finally(function () { Utils.setButtonLoading(btnComprovante, false); });
      });
    }
  }

  function loadThumbnails() {
    document.querySelectorAll('#imageGallery img[data-image-id]').forEach(function (img) {
      Api.loadImageInto(img, img.getAttribute('data-image-id'))
        .catch(function () { img.alt = 'Nao foi possivel carregar a imagem.'; });
    });

    document.querySelectorAll('[data-image-index]').forEach(function (button) {
      button.addEventListener('click', function () {
        openImage(Number(button.getAttribute('data-image-index')));
      });
    });
  }

  function openImage(index) {
    var image = currentImages[index];
    if (!image) return;

    var modalEl = document.getElementById('imageModal');
    document.getElementById('imageModalTitle').textContent = image.original_name || 'Comprovante';
    var img = document.getElementById('imageModalImg');
    img.removeAttribute('src');

    Api.loadImageInto(img, image.id).catch(function () {
      Utils.notify.error('Nao foi possivel carregar a imagem.');
    });

    var download = document.getElementById('btnDownloadImage');
    download.onclick = function () {
      Api.downloadImage(image.id, image.original_name)
        .catch(function () { Utils.notify.error('Nao foi possivel baixar a imagem.'); });
    };

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function onCancel() {
    Utils.confirmAction({
      title: 'Cancelar coleta',
      message: 'A coleta sera marcada como cancelada e deixara de entrar nos totais financeiros. ' +
        'O registro permanece no historico e a operacao fica registrada na auditoria. Esta acao nao pode ser desfeita.',
      confirmText: 'Cancelar coleta',
      danger: true,
      requireReason: true
    }).then(function (result) {
      if (!result.confirmed) return;

      var button = document.getElementById('btnCancelCollection');
      Utils.setButtonLoading(button, true, 'Cancelando...');

      Api.post('/collections/' + collectionId + '/cancel', { reason: result.reason })
        .then(function () {
          Utils.notify.success('Coleta cancelada. O registro permanece no historico.');
          load();
        })
        .catch(function (error) {
          Utils.setButtonLoading(button, false);
          Utils.notify.error(error.message);
        });
    });
  }

  function infoRow(label, value) {
    return '<dt class="col-5 fw-normal text-muted">' + Utils.escapeHtml(label) + '</dt>' +
      '<dd class="col-7 text-break-anywhere">' + value + '</dd>';
  }

  function valueRow(label, value) {
    return '<dt class="col-6 fw-normal text-muted">' + Utils.escapeHtml(label) + '</dt>' +
      '<dd class="col-6 text-end mb-1">' + value + '</dd>';
  }
}());
