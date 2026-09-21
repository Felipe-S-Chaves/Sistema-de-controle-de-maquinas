/** Gerenciamento de usuarios - somente administradores. */
(function () {
  'use strict';

  var state = { page: 1, pageSize: 20, search: '' };
  var modal = null;
  var form = null;

  var PAPEIS = {
    admin: { label: 'Administrador', css: 'text-bg-primary' },
    operator: { label: 'Operador', css: 'text-bg-info' }
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    // Quem chegou aqui sem permissao volta para o inicio.
    if (!Api.can('users.manage')) {
      window.location.replace('/index.html');
      return;
    }

    form = document.getElementById('userForm');
    modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('userModal'));

    document.getElementById('btnNewUser').addEventListener('click', openCreate);
    document.getElementById('searchInput').addEventListener('input', Utils.debounce(function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      load();
    }, 320));

    form.addEventListener('submit', onSubmit);
    load();
  });

  function load() {
    var container = document.getElementById('usersList');
    Utils.renderLoading(container, 4);

    Api.get('/users', { page: state.page, pageSize: state.pageSize, search: state.search || null })
      .then(function (payload) {
        renderPendentes(payload.data);
        render(payload.data);
        Utils.renderPagination(document.getElementById('usersPagination'), payload.pagination, function (page) {
          state.page = page;
          load();
        });
      })
      .catch(function (error) { Utils.renderError(container, error.message, load); });
  }

  /**
   * Aviso no topo quando ha contas aguardando liberacao.
   * Sem isso, alguem que se cadastrou pela tela de login ficaria esperando
   * sem que o administrador percebesse.
   */
  function renderPendentes(items) {
    var banner = document.getElementById('pendingBanner');
    var pendentes = items.filter(function (u) { return u.status === 'inactive'; });

    if (!pendentes.length) { banner.innerHTML = ''; return; }

    banner.innerHTML =
      '<div class="alert alert-warning d-flex flex-wrap align-items-center gap-2">' +
      '  <strong>' + pendentes.length + ' conta(s) aguardando liberacao.</strong>' +
      '  <span class="small">' +
      pendentes.map(function (u) { return Utils.escapeHtml(u.name); }).join(', ') +
      '  </span>' +
      '  <span class="small ms-auto">Use o botao <em>Ativar</em> na lista abaixo para liberar o acesso.</span>' +
      '</div>';
  }

  function render(items) {
    var container = document.getElementById('usersList');

    if (!items.length) {
      Utils.renderEmpty(container, 'Nenhum usuario encontrado.', '&#128101;');
      return;
    }

    var eu = Api.getUser() || {};

    var rows = items.map(function (u) {
      var papel = PAPEIS[u.role] || { label: u.role, css: 'text-bg-secondary' };
      var souEu = Number(u.id) === Number(eu.id);

      var pendente = u.status === 'inactive' && !u.last_login_at;

      return '<tr' + (pendente ? ' class="table-warning"' : '') + '>' +
        '<td data-label="Nome"><span class="fw-semibold">' + Utils.escapeHtml(u.name) + '</span>' +
        (souEu ? ' <span class="badge text-bg-light">voce</span>' : '') +
        (pendente ? ' <span class="badge text-bg-warning">aguardando liberacao</span>' : '') + '</td>' +
        '<td data-label="E-mail" class="text-break-anywhere">' + Utils.escapeHtml(u.email) + '</td>' +
        '<td data-label="Perfil"><span class="badge badge-status ' + papel.css + '">' +
        Utils.escapeHtml(papel.label) + '</span></td>' +
        '<td data-label="Coletas" class="text-end">' + (u.collections_count || 0) + '</td>' +
        '<td data-label="Ultimo acesso">' +
        (u.last_login_at ? Utils.formatDateTime(u.last_login_at) : 'Nunca entrou') + '</td>' +
        '<td data-label="Status">' + Utils.statusBadge(u.status, true) + '</td>' +
        '<td data-label="" class="cell-actions text-end">' +
        '  <div class="btn-group btn-group-sm">' +
        '    <button class="btn btn-outline-secondary" data-edit="' + u.id + '">Editar</button>' +
        (souEu ? ''
          : '    <button class="btn btn-outline-warning" data-toggle-status="' + u.id +
            '" data-status="' + u.status + '">' +
            (u.status === 'active' ? 'Desativar' : (pendente ? 'Liberar' : 'Ativar')) + '</button>') +
        (souEu || !Api.can('users.delete') ? ''
          : '    <button class="btn btn-outline-danger" data-delete="' + u.id +
            '" data-name="' + Utils.escapeHtml(u.name) + '">Apagar</button>') +
        '  </div>' +
        '</td></tr>';
    }).join('');

    container.innerHTML =
      '<div class="table-responsive-cards">' +
      '<table class="table table-hover align-middle mb-0">' +
      '<thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th>' +
      '<th class="text-end">Coletas</th><th>Ultimo acesso</th><th>Status</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    container.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { openEdit(btn.getAttribute('data-edit'), items); });
    });
    container.querySelectorAll('[data-toggle-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-toggle-status');
        var alvo = items.filter(function (u) { return String(u.id) === String(id); })[0] || {};
        toggleStatus(id, btn.getAttribute('data-status'), alvo.name || '', !alvo.last_login_at);
      });
    });
    container.querySelectorAll('[data-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        apagar(btn.getAttribute('data-delete'), btn.getAttribute('data-name'));
      });
    });
  }

  /**
   * Exclusao de conta - apenas administrador.
   * Quem ja registrou coletas nunca e apagado: o backend responde 409 e o
   * modal oferece desativar, que tira o acesso e preserva o historico.
   */
  function apagar(id, nome) {
    Deletion.run({
      entidade: 'user',
      caminho: '/users/' + id,
      rotulo: nome,
      desativar: function () {
        return Api.patch('/users/' + id + '/status', { status: 'inactive' })
          .then(function () { Utils.notify.success('Conta desativada. O historico foi mantido.'); });
      }
    }).then(function (mudou) { if (mudou) load(); });
  }

  function openCreate() {
    form.reset();
    Utils.clearFieldErrors(form);
    form.querySelector('[name="id"]').value = '';
    form.querySelector('[name="role"]').value = 'operator';
    form.querySelector('[name="status"]').value = 'active';

    document.getElementById('userModalTitle').textContent = 'Novo usuario';
    document.getElementById('passwordRequired').classList.remove('d-none');
    document.getElementById('passwordHint').textContent = 'Minimo de 8 caracteres.';
    modal.show();
  }

  function openEdit(id, items) {
    var u = items.filter(function (item) { return String(item.id) === String(id); })[0];
    if (!u) return;

    form.reset();
    Utils.clearFieldErrors(form);
    form.querySelector('[name="id"]').value = u.id;
    form.querySelector('[name="name"]').value = u.name || '';
    form.querySelector('[name="email"]').value = u.email || '';
    form.querySelector('[name="role"]').value = u.role || 'operator';
    form.querySelector('[name="status"]').value = u.status || 'active';

    document.getElementById('userModalTitle').textContent = 'Editar usuario';
    document.getElementById('passwordRequired').classList.add('d-none');
    document.getElementById('passwordHint').textContent =
      'Deixe em branco para manter a senha atual. Para trocar, digite a nova (minimo 8 caracteres).';
    modal.show();
  }

  function toggleStatus(id, statusAtual, nome, nuncaEntrou) {
    var proximo = statusAtual === 'active' ? 'inactive' : 'active';

    var mensagem;
    if (proximo === 'inactive') {
      mensagem = 'O usuario deixa de conseguir entrar no sistema. ' +
        'As coletas que ele registrou permanecem no historico.';
    } else if (nuncaEntrou) {
      mensagem = 'Liberar o acesso de "' + nome + '"? A partir de agora ele podera entrar e ' +
        'cadastrar clientes, maquinas e registrar coletas. Confirme que voce conhece esta pessoa.';
    } else {
      mensagem = 'O usuario volta a ter acesso ao sistema.';
    }

    Utils.confirmAction({
      title: proximo === 'inactive' ? 'Desativar usuario' : 'Liberar acesso',
      message: mensagem,
      confirmText: proximo === 'inactive' ? 'Desativar' : 'Liberar acesso',
      danger: proximo === 'inactive'
    }).then(function (resultado) {
      if (!resultado.confirmed) return;

      Api.patch('/users/' + id + '/status', { status: proximo })
        .then(function () { Utils.notify.success('Status atualizado.'); load(); })
        .catch(function (error) { Utils.notify.error(error.message); });
    });
  }

  function onSubmit(event) {
    event.preventDefault();

    var botao = document.getElementById('btnSaveUser');
    Utils.clearFieldErrors(form);

    var dados = Utils.formToObject(form);
    var id = dados.id;
    delete dados.id;
    if (!dados.password) delete dados.password;

    var erros = {};
    if (!dados.name) erros.name = 'Informe o nome.';
    if (!dados.email) erros.email = 'Informe o e-mail.';
    if (!id && !dados.password) erros.password = 'Informe a senha inicial.';
    if (dados.password && dados.password.length < 8) {
      erros.password = 'A senha deve ter no minimo 8 caracteres.';
    }
    if (Object.keys(erros).length) { Utils.applyFieldErrors(form, erros); return; }

    Utils.setButtonLoading(botao, true, 'Salvando...');

    var requisicao = id ? Api.put('/users/' + id, dados) : Api.post('/users', dados);

    requisicao
      .then(function (payload) {
        Utils.notify.success(payload.message || 'Usuario salvo.');
        modal.hide();
        load();
      })
      .catch(function (error) { Utils.handleApiError(error, form); })
      .finally(function () { Utils.setButtonLoading(botao, false); });
  }
}());
