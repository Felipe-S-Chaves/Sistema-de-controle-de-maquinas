/** Tela de login. */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    // Ja autenticado: vai direto para a tela inicial do perfil.
    if (Api.isAuthenticated() && !Utils.queryParam('expired')) {
      window.location.replace(Api.homePage());
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

    /**
     * Cadastro de operador na propria tela de login.
     * A conta e criada aguardando liberacao do administrador.
     */
    function bindRegistro() {
      var cartaoLogin = document.getElementById('loginCard');
      var cartaoCadastro = document.getElementById('registerCard');
      var formCadastro = document.getElementById('registerForm');
      var avisoCadastro = document.getElementById('registerAlert');
      var botao = document.getElementById('btnRegister');

      function mostrar(qual) {
        var ehCadastro = qual === 'cadastro';
        cartaoLogin.classList.toggle('d-none', ehCadastro);
        cartaoCadastro.classList.toggle('d-none', !ehCadastro);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (ehCadastro) document.getElementById('regName').focus();
      }

      function avisar(mensagem, tipo) {
        avisoCadastro.className = 'alert alert-' + (tipo || 'danger');
        avisoCadastro.textContent = mensagem;
      }

      function limparAviso() { avisoCadastro.className = 'alert d-none'; }

      /**
       * Contas disponiveis. A lista e publica de proposito: e so o nome, e sem
       * ela ninguem conseguiria pedir acesso. O que protege cada conta e a
       * liberacao pelo administrador dela, nao o segredo do nome.
       */
      function carregarContas() {
        var select = document.getElementById('regAccount');
        return Api.get('/auth/accounts')
          .then(function (payload) {
            var contas = payload.data || [];
            if (!contas.length) {
              select.innerHTML = '<option value="">Nenhuma conta disponivel</option>';
              return;
            }
            select.innerHTML = '<option value="">Selecione a conta</option>' +
              contas.map(function (c) {
                return '<option value="' + c.id + '">' + Utils.escapeHtml(c.name) + '</option>';
              }).join('');
          })
          .catch(function () {
            select.innerHTML = '<option value="">Nao foi possivel carregar</option>';
          });
      }

      document.getElementById('btnShowRegister').addEventListener('click', function () {
        limparAviso();
        Utils.clearFieldErrors(formCadastro);
        carregarContas();
        mostrar('cadastro');
      });

      document.getElementById('btnBackToLogin').addEventListener('click', function () {
        mostrar('login');
      });

      formCadastro.addEventListener('submit', function (event) {
        event.preventDefault();
        limparAviso();
        Utils.clearFieldErrors(formCadastro);

        var dados = Utils.formToObject(formCadastro);
        var erros = {};

        if (!dados.account_id) erros.account_id = 'Escolha a conta em que voce vai trabalhar.';
        if (!dados.name || dados.name.length < 3) erros.name = 'Informe seu nome completo.';
        if (!dados.email) erros.email = 'Informe seu e-mail.';
        if (!dados.password || dados.password.length < 8) {
          erros.password = 'A senha deve ter no minimo 8 caracteres.';
        }
        if (dados.password !== dados.passwordConfirm) {
          erros.passwordConfirm = 'A confirmacao precisa ser igual a senha.';
        }
        if (Object.keys(erros).length) { Utils.applyFieldErrors(formCadastro, erros); return; }

        Utils.setButtonLoading(botao, true, 'Enviando...');

        Api.post('/auth/register', dados)
          .then(function (resposta) {
            formCadastro.reset();
            formCadastro.classList.add('d-none');
            avisar(resposta.message || 'Cadastro enviado. Aguarde a liberacao do administrador.', 'success');

            // Volta sozinho para o login depois de ler o aviso.
            setTimeout(function () {
              formCadastro.classList.remove('d-none');
              limparAviso();
              mostrar('login');
            }, 6000);
          })
          .catch(function (erro) {
            if (erro.details) Utils.applyFieldErrors(formCadastro, erro.details);
            avisar(erro.message || 'Nao foi possivel enviar o cadastro.');
          })
          .finally(function () { Utils.setButtonLoading(botao, false); });
      });
    }

    bindRegistro();

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

          // Senha temporaria: ate trocar, o sistema inteiro fica fechado.
          if (payload.data.user.must_change_password) {
            window.location.replace('/change-password.html?required=1');
            return;
          }
          window.location.replace(Api.homePage());
        })
        .catch(function (error) {
          if (error.details) Utils.applyFieldErrors(form, error.details);
          showAlert(error.message || 'Nao foi possivel entrar.');
          Utils.setButtonLoading(button, false);
        });
    });
  });
}());
