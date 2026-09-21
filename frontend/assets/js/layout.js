/**
 * Casca da aplicacao: topo, menu lateral responsivo, busca global,
 * guarda de autenticacao e o modal de confirmacao compartilhado.
 */
window.Layout = (function () {
  'use strict';

  /**
   * Cada item declara a permissao necessaria. Quem nao tem, nem ve o item.
   * Isso e apenas conveniencia visual: quem realmente barra e o backend.
   */
  var MENU = [
    { href: '/collection-new.html', label: 'Nova coleta', icon: '&#10133;', permissao: 'collections.create' },
    { href: '/index.html', label: 'Dashboard', icon: '&#128202;', permissao: 'dashboard.full' },
    { href: '/owners.html', label: 'Clientes', icon: '&#128100;' },
    { href: '/machines.html', label: 'Maquinas', icon: '&#127925;' },
    { href: '/collections.html', label: 'Coletas', icon: '&#128203;' },
    { href: '/reports.html', label: 'Relatorios', icon: '&#128200;', permissao: 'reports.own' },
    { href: '/users.html', label: 'Usuarios', icon: '&#128101;', permissao: 'users.manage' },
    { href: '/audit.html', label: 'Auditoria', icon: '&#128269;', permissao: 'audit.view' }
  ];

  /** Redireciona para o login quando nao ha sessao valida. */
  function requireAuth() {
    if (!Api.isAuthenticated()) {
      window.location.replace('/login.html');
      return false;
    }
    return true;
  }

  function currentPath() {
    var path = window.location.pathname;
    return path === '/' ? '/index.html' : path;
  }

  function render() {
    if (!requireAuth()) return;

    var user = Api.getUser() || { name: 'Usuario', role: 'admin' };
    var path = currentPath();

    var menuHtml = MENU.filter(function (item) {
      return !item.permissao || Api.can(item.permissao);
    }).map(function (item) {
      var active = path === item.href ? ' active' : '';
      return '<a class="nav-link' + active + '" href="' + item.href + '">' +
        '<span aria-hidden="true">' + item.icon + '</span><span>' + item.label + '</span></a>';
    }).join('');

    var topbar = document.getElementById('appTopbar');
    if (topbar) {
      topbar.innerHTML =
        '<div class="container-fluid d-flex align-items-center gap-2 h-100 px-2 px-md-3">' +
        '<button class="btn btn-icon d-lg-none px-2" id="btnToggleSidebar" aria-label="Abrir menu">&#9776;</button>' +
        '<a class="navbar-brand me-auto text-truncate" href="' + Api.homePage() + '">Controle de Maquinas</a>' +
        (Api.can('owners.view')
          ? '<div class="global-search d-none d-md-block">' +
            '  <input type="search" class="form-control form-control-sm" id="globalSearchInput"' +
            '         placeholder="Buscar cliente ou maquina..." autocomplete="off" aria-label="Busca global">' +
            '  <div class="global-search-results d-none" id="globalSearchResults"></div>' +
            '</div>'
          : '<span class="me-auto"></span>') +
        '<div class="dropdown">' +
        '  <button class="btn btn-icon dropdown-toggle px-2" data-bs-toggle="dropdown" aria-expanded="false">' +
        '    <span class="d-none d-sm-inline">' + Utils.escapeHtml(user.name) + '</span>' +
        '    <span class="d-sm-none" aria-hidden="true">&#128100;</span>' +
        '  </button>' +
        '  <ul class="dropdown-menu dropdown-menu-end">' +
        '    <li><span class="dropdown-item-text small text-muted">' + Utils.escapeHtml(user.email || '') + '</span></li>' +
        '    <li><span class="dropdown-item-text small"><span class="badge text-bg-secondary">' +
        Utils.escapeHtml(user.role_label || user.role || '') + '</span>' +
        (user.account_name
          ? ' <span class="badge text-bg-light border">' + Utils.escapeHtml(user.account_name) + '</span>'
          : '') +
        '</span></li>' +
        '    <li><hr class="dropdown-divider"></li>' +
        '    <li><button class="dropdown-item" id="btnChangePassword">Alterar senha</button></li>' +
        '    <li><button class="dropdown-item text-danger" id="btnLogout">Sair</button></li>' +
        '  </ul>' +
        '</div>' +
        '</div>';
    }

    var sidebar = document.getElementById('appSidebar');
    if (sidebar) {
      sidebar.innerHTML =
        '<nav class="nav flex-column">' + menuHtml + '</nav>' +
        '<div class="d-md-none mt-3 pt-3 border-top">' +
        '  <input type="search" class="form-control form-control-sm" id="globalSearchInputMobile"' +
        '         placeholder="Buscar..." autocomplete="off" aria-label="Busca global">' +
        '  <div id="globalSearchResultsMobile" class="mt-2"></div>' +
        '</div>';
    }

    injectConfirmModal();
    bindSidebar();
    bindUserMenu();
    bindGlobalSearch();
  }

  function bindSidebar() {
    var sidebar = document.getElementById('appSidebar');
    var toggle = document.getElementById('btnToggleSidebar');
    if (!sidebar || !toggle) return;

    var backdrop = null;

    function close() {
      sidebar.classList.remove('open');
      if (backdrop) { backdrop.remove(); backdrop = null; }
    }

    toggle.addEventListener('click', function () {
      var opening = !sidebar.classList.contains('open');
      sidebar.classList.toggle('open', opening);
      if (opening) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop d-lg-none';
        backdrop.addEventListener('click', close);
        document.body.appendChild(backdrop);
      } else {
        close();
      }
    });

    sidebar.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', close);
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth >= 992) close();
    });
  }

  function bindUserMenu() {
    var logout = document.getElementById('btnLogout');
    if (logout) {
      logout.addEventListener('click', function () {
        Api.post('/auth/logout').catch(function () { /* encerra localmente mesmo se falhar */ })
          .then(function () { Api.clearSession(); window.location.replace('/login.html'); });
      });
    }

    var change = document.getElementById('btnChangePassword');
    if (change) {
      change.addEventListener('click', function () {
        var modalEl = document.getElementById('passwordModal');
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
      });
    }
  }

  function bindGlobalSearch() {
    [['globalSearchInput', 'globalSearchResults', true],
      ['globalSearchInputMobile', 'globalSearchResultsMobile', false]].forEach(function (pair) {
      var input = document.getElementById(pair[0]);
      var results = document.getElementById(pair[1]);
      if (!input || !results) return;

      var run = Utils.debounce(function () {
        var term = input.value.trim();
        if (term.length < 1) { results.classList.add('d-none'); results.innerHTML = ''; return; }

        Api.get('/search', { q: term }).then(function (payload) {
          var data = payload.data;
          var items = [];

          data.owners.forEach(function (o) {
            items.push('<a class="list-group-item list-group-item-action" href="/owner-detail.html?id=' + o.id + '">' +
              '<span class="badge text-bg-primary me-2">Cliente</span>' +
              Utils.escapeHtml(o.name) + '</a>');
          });
          data.machines.forEach(function (m) {
            items.push('<a class="list-group-item list-group-item-action" href="/machine-detail.html?id=' + m.id + '">' +
              '<span class="badge text-bg-info me-2">Maquina</span>' +
              Utils.escapeHtml(m.number + ' - ' + m.name) +
              '<small class="d-block text-muted">' + Utils.escapeHtml(m.owner_name) + '</small></a>');
          });

          results.innerHTML = items.length
            ? '<div class="list-group list-group-flush">' + items.join('') + '</div>'
            : '<div class="p-3 text-muted small">Nenhum resultado para "' + Utils.escapeHtml(term) + '".</div>';
          if (pair[2]) results.classList.remove('d-none');
        }).catch(function () { /* busca silenciosa */ });
      }, 280);

      input.addEventListener('input', run);

      if (pair[2]) {
        document.addEventListener('click', function (event) {
          if (!results.contains(event.target) && event.target !== input) results.classList.add('d-none');
        });
        input.addEventListener('focus', function () {
          if (results.innerHTML) results.classList.remove('d-none');
        });
      }
    });
  }

  function injectConfirmModal() {
    if (document.getElementById('confirmModal')) return;

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal fade" id="confirmModal" tabindex="-1" aria-hidden="true">' +
      '  <div class="modal-dialog modal-dialog-centered">' +
      '    <div class="modal-content">' +
      '      <div class="modal-header"><h5 class="modal-title" data-confirm-title>Confirmar</h5>' +
      '        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>' +
      '      <div class="modal-body">' +
      '        <p class="mb-3" data-confirm-message></p>' +
      '        <div class="d-none" data-confirm-reason-wrap>' +
      '          <label class="form-label" for="confirmReason">Motivo <span class="text-danger">*</span></label>' +
      '          <textarea class="form-control" id="confirmReason" data-confirm-reason rows="3"' +
      '                    placeholder="Descreva o motivo (minimo 10 caracteres)"></textarea>' +
      '          <div class="invalid-feedback" data-confirm-reason-error></div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal-footer flex-column flex-sm-row gap-2">' +
      '        <button type="button" class="btn btn-outline-secondary btn-touch w-100 w-sm-auto m-0" data-bs-dismiss="modal">Cancelar</button>' +
      '        <button type="button" class="btn btn-primary btn-touch w-100 w-sm-auto m-0" data-confirm-ok>Confirmar</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="modal fade" id="passwordModal" tabindex="-1" aria-hidden="true">' +
      '  <div class="modal-dialog modal-dialog-centered">' +
      '    <form class="modal-content" id="passwordForm" novalidate>' +
      '      <div class="modal-header"><h5 class="modal-title">Alterar senha</h5>' +
      '        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>' +
      '      <div class="modal-body">' +
      '        <div class="mb-3"><label class="form-label" for="currentPassword">Senha atual</label>' +
      '          <input type="password" class="form-control" id="currentPassword" name="currentPassword" autocomplete="current-password" required>' +
      '          <div class="invalid-feedback" data-error-for="currentPassword"></div></div>' +
      '        <div class="mb-0"><label class="form-label" for="newPassword">Nova senha</label>' +
      '          <input type="password" class="form-control" id="newPassword" name="newPassword" autocomplete="new-password" minlength="8" required>' +
      '          <div class="form-text">Minimo de 8 caracteres.</div>' +
      '          <div class="invalid-feedback" data-error-for="newPassword"></div></div>' +
      '      </div>' +
      '      <div class="modal-footer flex-column flex-sm-row gap-2">' +
      '        <button type="button" class="btn btn-outline-secondary btn-touch w-100 w-sm-auto m-0" data-bs-dismiss="modal">Cancelar</button>' +
      '        <button type="submit" class="btn btn-primary btn-touch w-100 w-sm-auto m-0">Salvar</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>';

    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    var form = document.getElementById('passwordForm');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var button = form.querySelector('button[type="submit"]');
      Utils.clearFieldErrors(form);
      Utils.setButtonLoading(button, true, 'Salvando...');

      Api.post('/auth/change-password', Utils.formToObject(form))
        .then(function () {
          Utils.notify.success('Senha alterada com sucesso.');
          form.reset();
          bootstrap.Modal.getOrCreateInstance(document.getElementById('passwordModal')).hide();
        })
        .catch(function (error) { Utils.handleApiError(error, form); })
        .finally(function () { Utils.setButtonLoading(button, false); });
    });
  }

  return { render: render, requireAuth: requireAuth };
}());

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('appTopbar')) Layout.render();
});
