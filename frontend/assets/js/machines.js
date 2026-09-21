/** Listagem, cadastro e edicao de maquinas. */
(function () {
  'use strict';

  var state = { page: 1, pageSize: 20, search: '', status: '', ownerId: '' };
  var modal = null;
  var form = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    form = document.getElementById('machineForm');
    modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('machineModal'));

    var btnNova = document.getElementById('btnNewMachine');
    if (Api.can('machines.create')) btnNova.addEventListener('click', openCreate);
    else btnNova.classList.add('d-none');
    document.getElementById('searchInput').addEventListener('input', Utils.debounce(function (e) {
      state.search = e.target.value.trim(); state.page = 1; load();
    }, 320));
    document.getElementById('statusFilter').addEventListener('change', function (e) {
      state.status = e.target.value; state.page = 1; load();
    });
    document.getElementById('ownerFilter').addEventListener('change', function (e) {
      state.ownerId = e.target.value; state.page = 1; load();
    });

    form.addEventListener('submit', onSubmit);

    loadOwners();
    load();

    var preset = Utils.queryParam('owner_id');
    if (preset) {
      state.ownerId = preset;
      setTimeout(function () { document.getElementById('ownerFilter').value = preset; }, 400);
    }
  });

  function loadOwners() {
    Api.get('/owners', { pageSize: 100 })
      .then(function (payload) {
        var options = payload.data.map(function (o) {
          return '<option value="' + o.id + '">' + Utils.escapeHtml(o.name) + '</option>';
        }).join('');
        document.getElementById('ownerFilter').innerHTML = '<option value="">Todos</option>' + options;
        document.getElementById('machineOwner').innerHTML =
          '<option value="">Selecione o cliente</option>' + options;
      })
      .catch(function () { Utils.notify.error('Nao foi possivel carregar a lista de clientes.'); });
  }

  function load() {
    var container = document.getElementById('machinesList');
    Utils.renderLoading(container, 5);

    Api.get('/machines', {
      page: state.page, pageSize: state.pageSize,
      search: state.search || null, status: state.status || null, owner_id: state.ownerId || null
    })
      .then(function (payload) {
        render(payload.data);
        Utils.renderPagination(document.getElementById('machinesPagination'), payload.pagination, function (page) {
          state.page = page; load(); window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  function render(items) {
    var container = document.getElementById('machinesList');

    if (!items.length) {
      Utils.renderEmpty(container,
        state.search ? 'Nenhuma maquina encontrada para "' + state.search + '".'
          : 'Nenhuma maquina cadastrada ainda.', '&#127925;');
      return;
    }

    var rows = items.map(function (m) {
      return '' +
        '<tr>' +
        '  <td data-label="Maquina"><a href="/machine-detail.html?id=' + m.id + '" class="fw-semibold">' +
        Utils.escapeHtml(m.number + ' - ' + m.name) + '</a></td>' +
        '  <td data-label="Cliente"><a href="/owner-detail.html?id=' + m.owner_id + '">' +
        Utils.escapeHtml(m.owner_name) + '</a></td>' +
        '  <td data-label="Instalacao">' + (m.installation_date ? Utils.formatDate(m.installation_date) : '-') + '</td>' +
        '  <td data-label="Status">' + Utils.statusBadge(m.status) + '</td>' +
        '  <td data-label="" class="cell-actions text-end">' +
        '    <div class="btn-group btn-group-sm">' +
        (Api.can('collections.create')
          ? '      <a class="btn btn-primary" href="/collection-new.html?machine_id=' + m.id + '">Coletar</a>'
          : '') +
        '      <a class="btn btn-outline-primary" href="/machine-detail.html?id=' + m.id + '">Ver</a>' +
        (Api.can('machines.update')
          ? '      <button class="btn btn-outline-secondary" data-edit="' + m.id + '">Editar</button>' +
            '      <button class="btn btn-outline-warning" data-toggle-status="' + m.id + '" data-status="' + m.status + '">' +
            (m.status === 'active' ? 'Manutencao' : 'Ativar') + '</button>'
          : '') +
        (Api.can('machines.delete')
          ? '      <button class="btn btn-outline-danger" data-delete="' + m.id +
            '" data-name="' + Utils.escapeHtml(m.number + ' - ' + m.name) + '">Apagar</button>'
          : '') +
        '    </div>' +
        '  </td>' +
        '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-hover align-middle mb-0">' +
      '  <thead><tr><th>Maquina</th><th>Cliente</th>' +
      '    <th>Instalacao</th><th>Status</th><th></th></tr></thead>' +
      '  <tbody>' + rows + '</tbody>' +
      '</table></div>';

    container.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { openEdit(btn.getAttribute('data-edit')); });
    });
    container.querySelectorAll('[data-toggle-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleStatus(btn.getAttribute('data-toggle-status'), btn.getAttribute('data-status'));
      });
    });
    container.querySelectorAll('[data-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        apagar(btn.getAttribute('data-delete'), btn.getAttribute('data-name'));
      });
    });
  }

  /**
   * Exclusao definitiva - apenas administrador.
   * Com coletas no historico, o modal oferece manutencao como alternativa:
   * a maquina sai de circulacao sem destruir o que ja foi apurado.
   */
  function apagar(id, rotulo) {
    Deletion.run({
      entidade: 'machine',
      caminho: '/machines/' + id,
      rotulo: rotulo,
      desativar: function () {
        return Api.patch('/machines/' + id + '/status', { status: 'maintenance' })
          .then(function () { Utils.notify.success('Maquina em manutencao. O historico foi mantido.'); });
      }
    }).then(function (mudou) { if (mudou) load(); });
  }

  function toggleStatus(id, currentStatus) {
    var next = currentStatus === 'active' ? 'maintenance' : 'active';
    Utils.confirmAction({
      title: 'Alterar status',
      message: next === 'maintenance'
        ? 'Colocar esta maquina em manutencao?'
        : 'Marcar esta maquina como ativa?',
      confirmText: 'Alterar'
    }).then(function (result) {
      if (!result.confirmed) return;
      Api.patch('/machines/' + id + '/status', { status: next })
        .then(function () { Utils.notify.success('Status atualizado.'); load(); })
        .catch(function (error) { Utils.notify.error(error.message); });
    });
  }

  function openCreate() {
    form.reset();
    Utils.clearFieldErrors(form);
    form.querySelector('[name="id"]').value = '';
    if (state.ownerId) form.querySelector('[name="owner_id"]').value = state.ownerId;
    document.getElementById('machineModalTitle').textContent = 'Nova maquina';
    modal.show();
  }

  function openEdit(id) {
    Utils.clearFieldErrors(form);
    Api.get('/machines/' + id)
      .then(function (payload) {
        var m = payload.data;
        form.reset();
        form.querySelector('[name="id"]').value = m.id;
        form.querySelector('[name="number"]').value = m.number || '';
        form.querySelector('[name="name"]').value = m.name || '';
        form.querySelector('[name="owner_id"]').value = m.owner_id || '';
        form.querySelector('[name="installation_date"]').value = m.installation_date || '';
        form.querySelector('[name="status"]').value = m.status || 'active';
        form.querySelector('[name="notes"]').value = m.notes || '';
        document.getElementById('machineModalTitle').textContent = 'Editar maquina';
        modal.show();
      })
      .catch(function (error) { Utils.notify.error(error.message); });
  }

  function onSubmit(event) {
    event.preventDefault();
    var button = document.getElementById('btnSaveMachine');
    Utils.clearFieldErrors(form);

    var data = Utils.formToObject(form);
    var id = data.id;
    delete data.id;

    var errors = {};
    if (!data.number) errors.number = 'Informe o numero da maquina.';
    if (!data.name) errors.name = 'Informe o nome da maquina.';
    if (!data.owner_id) errors.owner_id = 'Selecione o cliente.';
    if (Object.keys(errors).length) { Utils.applyFieldErrors(form, errors); return; }

    Utils.setButtonLoading(button, true, 'Salvando...');

    var request = id ? Api.put('/machines/' + id, data) : Api.post('/machines', data);
    request
      .then(function (payload) {
        Utils.notify.success(payload.message || 'Maquina salva.');
        modal.hide();
        load();
      })
      .catch(function (error) { Utils.handleApiError(error, form); })
      .finally(function () { Utils.setButtonLoading(button, false); });
  }
}());
