/** Listagem, cadastro e edicao de proprietarios. */
(function () {
  'use strict';

  var state = { page: 1, pageSize: 20, search: '', status: '' };
  var modal = null;
  var form = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    form = document.getElementById('ownerForm');
    modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('ownerModal'));

    document.getElementById('btnNewOwner').addEventListener('click', openCreate);
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
    });
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
        state.search ? 'Nenhum proprietario encontrado para "' + state.search + '".'
          : 'Nenhum proprietario cadastrado ainda.', '&#128100;');
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
        '      <button class="btn btn-outline-secondary" data-edit="' + o.id + '">Editar</button>' +
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
  }

  function openCreate() {
    form.reset();
    Utils.clearFieldErrors(form);
    form.querySelector('[name="id"]').value = '';
    document.getElementById('ownerModalTitle').textContent = 'Novo proprietario';
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
        document.getElementById('ownerModalTitle').textContent = 'Editar proprietario';
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

    Utils.setButtonLoading(button, true, 'Salvando...');

    var request = id ? Api.put('/owners/' + id, data) : Api.post('/owners', data);

    request
      .then(function (payload) {
        Utils.notify.success(payload.message || 'Proprietario salvo.');
        modal.hide();
        load();
      })
      .catch(function (error) { Utils.handleApiError(error, form); })
      .finally(function () { Utils.setButtonLoading(button, false); });
  }
}());
