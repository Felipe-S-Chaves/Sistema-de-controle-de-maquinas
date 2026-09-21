/**
 * Troca de senha em tela cheia.
 *
 * Existe por causa da senha temporaria: a conta nova nasce com uma senha
 * sorteada na instalacao e o backend fecha o sistema inteiro ate ela ser
 * trocada. Como nada mais responde, a troca precisa acontecer fora do app,
 * numa tela que so depende do login.
 *
 * A mesma tela serve para quem quiser trocar a senha por vontade propria.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) {
      window.location.replace('/login.html');
      return;
    }

    var obrigatorio = Utils.queryParam('required') === '1';
    var form = document.getElementById('formSenha');
    var alerta = document.getElementById('alerta');
    var botao = document.getElementById('btnSalvar');

    if (obrigatorio) {
      document.getElementById('avisoObrigatorio').classList.remove('d-none');
    } else {
      document.getElementById('subtitulo').textContent = 'Escolha uma nova senha para sua conta.';
      document.getElementById('dicaAtual').textContent = 'A senha que voce usa hoje.';
    }

    document.getElementById('btnSair').addEventListener('click', function () {
      Api.post('/auth/logout').catch(function () { /* encerra localmente mesmo assim */ })
        .then(function () { Api.clearSession(); window.location.replace('/login.html'); });
    });

    function avisar(mensagem, tipo) {
      alerta.className = 'alert alert-' + (tipo || 'danger');
      alerta.textContent = mensagem;
    }

    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      alerta.className = 'alert d-none';
      Utils.clearFieldErrors(form);

      var dados = Utils.formToObject(form);
      var erros = {};

      if (!dados.currentPassword) erros.currentPassword = 'Informe a senha atual.';
      if (!dados.newPassword || dados.newPassword.length < 8) {
        erros.newPassword = 'A nova senha deve ter no minimo 8 caracteres.';
      }
      if (dados.newPassword !== dados.confirm) {
        erros.confirm = 'A confirmacao precisa ser igual a nova senha.';
      }
      if (dados.currentPassword && dados.newPassword === dados.currentPassword) {
        erros.newPassword = 'A nova senha precisa ser diferente da atual.';
      }
      if (Object.keys(erros).length) { Utils.applyFieldErrors(form, erros); return; }

      Utils.setButtonLoading(botao, true, 'Salvando...');

      Api.post('/auth/change-password', {
        currentPassword: dados.currentPassword,
        newPassword: dados.newPassword
      })
        .then(function () {
          // A sessao guardada ainda diz que a senha e temporaria. Buscar o
          // perfil de novo evita o usuario voltar para esta tela em loop.
          return Api.get('/auth/me').then(function (payload) {
            Api.updateUser(payload.data);
            Utils.notify.success('Senha alterada. Bem-vindo!');
            setTimeout(function () { window.location.replace(Api.homePage()); }, 600);
          });
        })
        .catch(function (erro) {
          if (erro.details) Utils.applyFieldErrors(form, erro.details);
          avisar(erro.message || 'Nao foi possivel alterar a senha.');
          Utils.setButtonLoading(botao, false);
        });
    });
  });
}());
