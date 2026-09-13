/** Tela de login. */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    // Ja autenticado: vai direto para o dashboard.
    if (Api.isAuthenticated() && !Utils.queryParam('expired')) {
      window.location.replace('/index.html');
      return;
    }

    var form = document.getElementById('loginForm');
    var alertBox = document.getElementById('loginAlert');
    var button = document.getElementById('btnLogin');

    if (Utils.queryParam('expired')) {
      showAlert('Sua sessao expirou. Faca login novamente.');
    }

    var toggle = document.getElementById('btnTogglePassword');
    var passwordInput = document.getElementById('password');
    toggle.addEventListener('click', function () {
      var isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      toggle.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
    });

    function showAlert(message) {
      alertBox.textContent = message;
      alertBox.classList.remove('d-none');
    }

    function hideAlert() { alertBox.classList.add('d-none'); }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      hideAlert();
      Utils.clearFieldErrors(form);

      var data = Utils.formToObject(form);
      var localErrors = {};
      if (!data.email) localErrors.email = 'Informe seu e-mail.';
      if (!data.password) localErrors.password = 'Informe sua senha.';
      if (Object.keys(localErrors).length) { Utils.applyFieldErrors(form, localErrors); return; }

      Utils.setButtonLoading(button, true, 'Entrando...');

      Api.post('/auth/login', { email: data.email, password: data.password })
        .then(function (payload) {
          var remember = document.getElementById('remember').checked;
          Api.setSession(payload.data.token, payload.data.user, remember);
          window.location.replace('/index.html');
        })
        .catch(function (error) {
          if (error.details) Utils.applyFieldErrors(form, error.details);
          showAlert(error.message || 'Nao foi possivel entrar.');
          Utils.setButtonLoading(button, false);
        });
    });
  });
}());
