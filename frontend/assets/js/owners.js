/** Listagem, cadastro e edicao de clientes. */
(function () {
  'use strict';

  var fotoDocumento = null;   // File escolhido agora, antes de salvar

  var state = { page: 1, pageSize: 20, search: '', status: '' };
  var modal = null;
  var form = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    form = document.getElementById('ownerForm');
    modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('ownerModal'));

    var btnNovo = document.getElementById('btnNewOwner');
    if (Api.can('owners.create')) btnNovo.addEventListener('click', openCreate);
    else btnNovo.classList.add('d-none');
    document.getElementById('searchInput').addEventListener('input', Utils.debounce(function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      load();
    }, 320));
    document.getElementById('statusFilter').addEventListener('change', function (e) {
      state.status = e.target.value;
      state.page = 1;
      load();
    });

    bindFotoDocumento();
    form.addEventListener('submit', onSubmit);
    bindMasks();
    load();
  });

  function bindMasks() {
    var doc = document.getElementById('ownerDocument');
    doc.addEventListener('input', function () {
      var d = doc.value.replace(/\D/g, '').slice(0, 14);
      if (d.length <= 11) {
        doc.value = d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
          .replace(/\.(\d{3})(\d)/, '.$1-$2');
      } else {
        doc.value = d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
          .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
      }
    });

    ['ownerPhone', 'ownerWhatsapp'].forEach(function (id) {
      var input = document.getElementById(id);
      input.addEventListener('input', function () {
        var d = input.value.replace(/\D/g, '').slice(0, 11);
        if (d.length > 10) input.value = d.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3');
        else if (d.length > 6) input.value = d.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3');
        else if (d.length > 2) input.value = d.replace(/^(\d{2})(\d{0,5})/, '($1) $2');
        else input.value = d;
      });
    });

    var zip = document.getElementById('ownerZip');
    zip.addEventListener('input', function () {
      var d = zip.value.replace(/\D/g, '').slice(0, 8);
      zip.value = d.length > 5 ? d.replace(/^(\d{5})(\d{0,3})/, '$1-$2') : d;
      if (d.length === 8) buscarCep(d);
    });
    zip.addEventListener('blur', function () {
      var d = zip.value.replace(/\D/g, '');
      if (d.length === 8) buscarCep(d);
    });
  }

  /**
   * Preenche endereco, cidade e UF a partir do CEP (ViaCEP).
   *
   * O preenchimento e uma comodidade, nunca um bloqueio: se a consulta
   * falhar (sem internet, servico fora do ar), o usuario digita na mao
   * e o cadastro segue normalmente.
   */
  var ultimoCepBuscado = null;

  function buscarCep(cep) {
    if (cep === ultimoCepBuscado) return;
    ultimoCepBuscado = cep;

    var aviso = document.getElementById('cepFeedback');
    var campos = {
      address: document.getElementById('ownerAddress'),
      city: document.getElementById('ownerCity'),
      state: document.getElementById('ownerState')
    };

    aviso.className = 'form-text text-muted';
    aviso.textContent = 'Buscando endereco...';

    var controle = new AbortController();
    var prazo = setTimeout(function () { controle.abort(); }, 6000);

    fetch('https://viacep.com.br/ws/' + cep + '/json/', { signal: controle.signal })
      .then(function (resposta) {
        if (!resposta.ok) throw new Error('falha');
        return resposta.json();
      })
      .then(function (dados) {
        if (dados.erro) {
          aviso.className = 'form-text text-warning';
          aviso.textContent = 'CEP nao encontrado. Preencha o endereco manualmente.';
          return;
        }

        // So preenche o que estiver vazio, para nao apagar o que o usuario digitou.
        var logradouro = [dados.logradouro, dados.bairro].filter(Boolean).join(' - ');
        if (logradouro && !campos.address.value.trim()) campos.address.value = logradouro;
        if (dados.localidade && !campos.city.value.trim()) campos.city.value = dados.localidade;
        if (dados.uf && !campos.state.value.trim()) campos.state.value = dados.uf;

        aviso.className = 'form-text text-success';
        aviso.textContent = 'Endereco preenchido. Confira e complete o numero.';

        // Leva o cursor para o campo do endereco, onde falta o numero.
        if (campos.address.value) {
          campos.address.focus();
          campos.address.setSelectionRange(campos.address.value.length, campos.address.value.length);
        }
      })
      .catch(function () {
        aviso.className = 'form-text text-muted';
        aviso.textContent = 'Nao foi possivel consultar o CEP. Preencha o endereco manualmente.';
      })
      .finally(function () { clearTimeout(prazo); });
  }

  function load() {
    var container = document.getElementById('ownersList');
    Utils.renderLoading(container, 5);

    Api.get('/owners', {
      page: state.page, pageSize: state.pageSize,
      search: state.search || null, status: state.status || null
    })
      .then(function (payload) {
        render(payload.data);
        Utils.renderPagination(document.getElementById('ownersPagination'), payload.pagination, function (page) {
          state.page = page;
          load();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  function render(items) {
    var container = document.getElementById('ownersList');

    if (!items.length) {
      Utils.renderEmpty(container,
        state.search ? 'Nenhum cliente encontrado para "' + state.search + '".'
          : 'Nenhum cliente cadastrado ainda.', '&#128100;');
      return;
    }

    var rows = items.map(function (o) {
      return '' +
        '<tr>' +
        '  <td data-label="Nome"><a href="/owner-detail.html?id=' + o.id + '" class="fw-semibold">' +
        Utils.escapeHtml(o.name) + '</a></td>' +
        '  <td data-label="CPF/CNPJ">' + Utils.formatDocument(o.document, o.document_type) + '</td>' +
        '  <td data-label="Telefone">' + Utils.formatPhone(o.phone) + '</td>' +
        '  <td data-label="Maquinas" class="text-end">' + o.machines_count +
        ' <span class="text-muted small">(' + o.active_machines_count + ' ativas)</span></td>' +
        '  <td data-label="Status">' + Utils.statusBadge(o.status, true) + '</td>' +
        '  <td data-label="" class="cell-actions text-end">' +
        '    <div class="btn-group btn-group-sm">' +
        '      <a class="btn btn-outline-primary" href="/owner-detail.html?id=' + o.id + '">Ver</a>' +
        (Api.can('owners.update')
          ? '      <button class="btn btn-outline-secondary" data-edit="' + o.id + '">Editar</button>'
          : '') +
        (Api.can('owners.delete')
          ? '      <button class="btn btn-outline-danger" data-delete="' + o.id +
            '" data-name="' + Utils.escapeHtml(o.name) + '" aria-label="Apagar ' +
            Utils.escapeHtml(o.name) + '">Apagar</button>'
          : '') +
        '    </div>' +
        '  </td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-hover align-middle mb-0">' +
      '  <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Telefone</th>' +
      '    <th class="text-end">Maquinas</th><th>Status</th><th></th></tr></thead>' +
      '  <tbody>' + rows + '</tbody>' +
      '</table></div>';

    container.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { openEdit(btn.getAttribute('data-edit')); });
    });
    container.querySelectorAll('[data-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        apagar(btn.getAttribute('data-delete'), btn.getAttribute('data-name'));
      });
    });
  }

  /**
   * Exclusao definitiva - apenas administrador.
   * Se houver maquinas ou coletas, o backend responde 409 e o modal oferece
   * desativar como alternativa a destruicao do historico.
   */
  function apagar(id, nome) {
    Deletion.run({
      entidade: 'owner',
      caminho: '/owners/' + id,
      rotulo: nome,
      desativar: function () {
        return Api.patch('/owners/' + id + '/status', { status: 'inactive' })
          .then(function () { Utils.notify.success('Cliente desativado. O historico foi mantido.'); });
      }
    }).then(function (mudou) { if (mudou) load(); });
  }

  // ------------------------------------------------------------------
  // Foto do documento
  //
  // Obrigatoria no cadastro: e a comprovacao de quem esta sendo cadastrado.
  // Na edicao, a foto que ja existe continua valendo - so trocar se quiser.
  // ------------------------------------------------------------------
  function bindFotoDocumento() {
    var camera = document.getElementById('ownerDocCamera');
    var galeria = document.getElementById('ownerDocGallery');

    document.getElementById('btnDocCamera').addEventListener('click', function () { camera.click(); });
    document.getElementById('btnDocGallery').addEventListener('click', function () { galeria.click(); });

    [camera, galeria].forEach(function (input) {
      input.addEventListener('change', function () {
        // Copia a lista ANTES de limpar o input: limpar primeiro esvazia
        // o FileList e a foto se perde sem aviso.
        var arquivos = Array.prototype.slice.call(input.files);
        input.value = '';
        if (arquivos.length) receberFoto(arquivos[0]);
      });
    });
  }

  function receberFoto(file) {
    var preview = document.getElementById('docPhotoPreview');
    preview.innerHTML = '<span class="text-muted small">Preparando a foto...</span>';

    Utils.comprimirImagem(file).then(function (pronta) {
      fotoDocumento = pronta;
      Utils.clearFieldErrors(form);

      var url = URL.createObjectURL(pronta);
      preview.innerHTML =
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
        '  <img src="' + url + '" alt="Documento do cliente" class="rounded border"' +
        '       style="width:96px;height:96px;object-fit:cover">' +
        '  <div class="small">' +
        '    <div class="fw-semibold">Foto anexada</div>' +
        '    <div class="text-muted">' + Utils.tamanhoLegivel(pronta.size) + '</div>' +
        '    <button type="button" class="btn btn-sm btn-link px-0 text-danger" id="btnDocRemove">Remover</button>' +
        '  </div>' +
        '</div>';

      document.getElementById('btnDocRemove').addEventListener('click', function () {
        URL.revokeObjectURL(url);
        limparFoto();
      });
    });
  }

  /** Mostra a foto que ja esta gravada, na edicao. */
  function mostrarFotoAtual(ownerId) {
    var preview = document.getElementById('docPhotoPreview');
    preview.innerHTML =
      '<div class="d-flex align-items-center gap-2 flex-wrap">' +
      '  <img alt="Documento do cliente" class="rounded border" data-doc-photo' +
      '       style="width:96px;height:96px;object-fit:cover">' +
      '  <div class="small text-muted">Foto ja cadastrada. Envie outra para substituir.</div>' +
      '</div>';
    Api.loadImageInto(preview.querySelector('[data-doc-photo]'), '/owners/' + ownerId + '/document-photo');
  }

  function limparFoto() {
    fotoDocumento = null;
    document.getElementById('docPhotoPreview').innerHTML = '';
  }

  function openCreate() {
    form.reset();
    Utils.clearFieldErrors(form);
    limparFoto();
    form.querySelector('[name="id"]').value = '';
    document.getElementById('docPhotoRequired').classList.remove('d-none');
    document.getElementById('docPhotoHint').textContent =
      'Obrigatoria: anexe uma foto legivel do documento do cliente.';
    document.getElementById('ownerModalTitle').textContent = 'Novo cliente';
    modal.show();
  }

  function openEdit(id) {
    Utils.clearFieldErrors(form);
    Api.get('/owners/' + id)
      .then(function (payload) {
        var o = payload.data;
        form.reset();
        form.querySelector('[name="id"]').value = o.id;
        form.querySelector('[name="name"]').value = o.name || '';
        form.querySelector('[name="document"]').value = o.document ? Utils.formatDocument(o.document, o.document_type) : '';
        form.querySelector('[name="email"]').value = o.email || '';
        form.querySelector('[name="phone"]').value = Utils.formatPhone(o.phone) === '-' ? '' : Utils.formatPhone(o.phone);
        form.querySelector('[name="whatsapp"]').value = Utils.formatPhone(o.whatsapp) === '-' ? '' : Utils.formatPhone(o.whatsapp);
        form.querySelector('[name="address"]').value = o.address || '';
        form.querySelector('[name="city"]').value = o.city || '';
        form.querySelector('[name="state"]').value = o.state || '';
        form.querySelector('[name="zip_code"]').value = o.zip_code || '';
        form.querySelector('[name="notes"]').value = o.notes || '';
        form.querySelector('[name="status"]').value = o.status || 'active';

        limparFoto();
        document.getElementById('docPhotoRequired').classList.add('d-none');
        document.getElementById('docPhotoHint').textContent = o.document_photo_path
          ? 'Ja existe uma foto. Envie outra apenas se quiser substituir.'
          : 'Este cliente foi cadastrado antes da foto ser exigida. Anexe agora se tiver.';
        if (o.document_photo_path) mostrarFotoAtual(o.id);

        document.getElementById('ownerModalTitle').textContent = 'Editar cliente';
        modal.show();
      })
      .catch(function (error) { Utils.notify.error(error.message); });
  }

  function onSubmit(event) {
    event.preventDefault();
    var button = document.getElementById('btnSaveOwner');
    Utils.clearFieldErrors(form);

    var data = Utils.formToObject(form);
    var id = data.id;
    delete data.id;

    if (!data.name) {
      Utils.applyFieldErrors(form, { name: 'Informe o nome ou razao social.' });
      return;
    }
    if (!id && !fotoDocumento) {
      Utils.applyFieldErrors(form, { document_photo: 'Anexe a foto do documento do cliente.' });
      Utils.notify.error('A foto do documento e obrigatoria no cadastro.');
      return;
    }

    Utils.setButtonLoading(button, true, 'Salvando...');

    // Vai como multipart por causa da foto.
    var pacote = new FormData();
    Object.keys(data).forEach(function (chave) {
      if (data[chave] !== null && data[chave] !== undefined) pacote.append(chave, data[chave]);
    });
    if (fotoDocumento) pacote.append('document_photo', fotoDocumento, fotoDocumento.name);

    var request = id ? Api.uploadPut('/owners/' + id, pacote) : Api.upload('/owners', pacote);

    request
      .then(function (payload) {
        Utils.notify.success(payload.message || 'Cliente salvo.');
        modal.hide();
        load();
      })
      .catch(function (error) { Utils.handleApiError(error, form); })
      .finally(function () { Utils.setButtonLoading(button, false); });
  }
}());
