/**
 * Exclusao definitiva de clientes, maquinas e usuarios.
 *
 * O botao de apagar so aparece para o administrador, mas a interface nunca
 * decide sozinha o que fazer com historico financeiro. O backend responde 409
 * quando existe historico, e aqui o administrador escolhe na hora entre
 * desativar (guarda tudo) ou apagar tudo (destroi de vez).
 *
 * A saida destrutiva exige digitar APAGAR: e a ultima barreira antes de
 * perder coletas e fotos que nao voltam.
 */
window.Deletion = (function () {
  'use strict';

  // A primeira pergunta nao afirma que nao ha historico - quem sabe disso e o
  // backend. Ela avisa que existe uma segunda barreira, caso haja.
  var TEXTOS = {
    owner: {
      titulo: 'Apagar cliente',
      aviso: 'O cadastro sai do sistema em definitivo. Se houver maquinas ou coletas ' +
        'ligadas a ele, o sistema avisa antes de destruir qualquer historico.'
    },
    machine: {
      titulo: 'Apagar maquina',
      aviso: 'O cadastro sai do sistema em definitivo. Se houver coletas registradas, ' +
        'o sistema avisa antes de destruir o historico.'
    },
    user: {
      titulo: 'Apagar usuario',
      aviso: 'A conta sai do sistema em definitivo. Se esta pessoa ja registrou coletas, ' +
        'a exclusao e barrada - as coletas pertencem ao negocio.'
    }
  };

  /** Modal criado sob demanda: as tres telas usam o mesmo. */
  function elemento() {
    var el = document.getElementById('deletionModal');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'deletionModal';
    el.className = 'modal fade';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="modal-dialog modal-dialog-centered">' +
      '  <div class="modal-content">' +
      '    <div class="modal-header">' +
      '      <h5 class="modal-title" data-del-title>Apagar registro</h5>' +
      '      <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>' +
      '    </div>' +
      '    <div class="modal-body">' +
      '      <p class="mb-2" data-del-message></p>' +
      '      <ul class="list-unstyled small text-muted mb-3 d-none" data-del-list></ul>' +
      '      <div class="d-none" data-del-typewrap>' +
      '        <label class="form-label small" for="deletionConfirmInput">' +
      '          Para confirmar, digite <strong>APAGAR</strong>:</label>' +
      '        <input type="text" class="form-control" id="deletionConfirmInput"' +
      '               autocomplete="off" autocapitalize="characters" data-del-type>' +
      '      </div>' +
      '    </div>' +
      '    <div class="modal-footer flex-wrap gap-2">' +
      '      <button type="button" class="btn btn-touch btn-outline-secondary"' +
      '              data-bs-dismiss="modal">Cancelar</button>' +
      '      <button type="button" class="btn btn-touch btn-warning d-none" data-del-deactivate>Desativar</button>' +
      '      <button type="button" class="btn btn-touch btn-danger" data-del-confirm>Apagar</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(el);
    return el;
  }

  /**
   * Abre o modal e resolve com a escolha do administrador:
   * 'delete', 'deactivate' ou null (desistiu).
   */
  function perguntar(opcoes) {
    return new Promise(function (resolve) {
      var el = elemento();
      var modal = bootstrap.Modal.getOrCreateInstance(el);

      var titulo = el.querySelector('[data-del-title]');
      var mensagem = el.querySelector('[data-del-message]');
      var lista = el.querySelector('[data-del-list]');
      var typeWrap = el.querySelector('[data-del-typewrap]');
      var typeInput = el.querySelector('[data-del-type]');
      var btnDeactivate = el.querySelector('[data-del-deactivate]');
      var btnConfirm = el.querySelector('[data-del-confirm]');

      titulo.textContent = opcoes.titulo;
      mensagem.textContent = opcoes.mensagem;

      if (opcoes.itens && opcoes.itens.length) {
        lista.innerHTML = opcoes.itens.map(function (i) {
          return '<li>&bull; ' + Utils.escapeHtml(i) + '</li>';
        }).join('');
        lista.classList.remove('d-none');
      } else {
        lista.innerHTML = '';
        lista.classList.add('d-none');
      }

      typeInput.value = '';
      typeInput.classList.remove('is-invalid');
      typeWrap.classList.toggle('d-none', !opcoes.exigirDigitacao);

      btnDeactivate.classList.toggle('d-none', !opcoes.oferecerDesativar);
      btnConfirm.classList.toggle('d-none', opcoes.esconderApagar === true);
      btnConfirm.textContent = opcoes.textoApagar || 'Apagar';

      var resolvido = null;

      // Fechar so registra a escolha e manda esconder: quem resolve a promessa
      // e o evento 'hidden', depois que o modal realmente saiu da tela. Assim
      // a proxima pergunta (o aviso de historico) nao disputa espaco com esta.
      function fechar(escolha) {
        resolvido = escolha;
        modal.hide();
      }

      function noApagar() {
        if (opcoes.exigirDigitacao && typeInput.value.trim().toUpperCase() !== 'APAGAR') {
          typeInput.classList.add('is-invalid');
          typeInput.focus();
          return;
        }
        fechar('delete');
      }

      function noDesativar() { fechar('deactivate'); }

      function noFechado() {
        btnConfirm.removeEventListener('click', noApagar);
        btnDeactivate.removeEventListener('click', noDesativar);
        el.removeEventListener('hidden.bs.modal', noFechado);
        resolve(resolvido);
      }

      btnConfirm.addEventListener('click', noApagar);
      btnDeactivate.addEventListener('click', noDesativar);
      el.addEventListener('hidden.bs.modal', noFechado);
      modal.show();
    });
  }

  /** Transforma o resumo do 409 em linhas legiveis. */
  function itensDoResumo(d) {
    var itens = [];
    if (d.maquinas) itens.push(d.maquinas + ' maquina(s) cadastrada(s)');
    if (d.coletas) itens.push(d.coletas + ' coleta(s) no historico');
    if (d.fotos) itens.push(d.fotos + ' foto(s) de coleta');
    if (d.total !== undefined && d.total !== null) {
      itens.push(Utils.formatMoney(d.total) + ' em valor bruto');
    }
    return itens;
  }

  /**
   * Fluxo completo de exclusao.
   *
   * opcoes = {
   *   entidade: 'owner' | 'machine' | 'user',
   *   caminho:  '/owners/12',
   *   rotulo:   'Nome que aparece na confirmacao',
   *   desativar: function () -> Promise   (opcional; o que fazer no lugar de apagar)
   * }
   * Resolve com true quando algo mudou na lista e ela deve ser recarregada.
   */
  function run(opcoes) {
    var textos = TEXTOS[opcoes.entidade] || TEXTOS.owner;

    return perguntar({
      titulo: textos.titulo,
      mensagem: '"' + opcoes.rotulo + '": ' + textos.aviso,
      textoApagar: 'Apagar'
    }).then(function (escolha) {
      if (escolha !== 'delete') return false;
      return Api.del(opcoes.caminho)
        .then(function (resposta) {
          Utils.notify.success(resposta.message || 'Registro removido.');
          return true;
        })
        .catch(function (erro) { return tratarConflito(erro, opcoes); });
    });
  }

  /** O backend barrou: o administrador decide o que fazer agora. */
  function tratarConflito(erro, opcoes) {
    var d = erro.details || {};

    // Usuario com coletas: apagar nunca e opcao, porque as coletas dele
    // sustentam o encadeamento das leituras das maquinas.
    if (erro.code === 'USER_HAS_COLLECTIONS') {
      return perguntar({
        titulo: 'Esta conta nao pode ser apagada',
        mensagem: erro.message,
        itens: itensDoResumo({ coletas: d.coletas }),
        oferecerDesativar: !!opcoes.desativar,
        esconderApagar: true
      }).then(function (escolha) {
        if (escolha === 'deactivate' && opcoes.desativar) {
          return Promise.resolve(opcoes.desativar()).then(function () { return true; });
        }
        return false;
      });
    }

    if (erro.code !== 'HAS_HISTORY') {
      Utils.notify.error(erro.message);
      return false;
    }

    return perguntar({
      titulo: 'Existe historico ligado a este registro',
      mensagem: 'Apagar destroi tambem, em definitivo, o que esta listado abaixo. ' +
        'Desativar mantem tudo no historico e apenas tira o registro de circulacao.',
      itens: itensDoResumo(d),
      oferecerDesativar: !!opcoes.desativar,
      exigirDigitacao: true,
      textoApagar: 'Apagar tudo'
    }).then(function (escolha) {
      if (escolha === 'deactivate' && opcoes.desativar) {
        return Promise.resolve(opcoes.desativar()).then(function () { return true; });
      }
      if (escolha !== 'delete') return false;

      return Api.del(opcoes.caminho, { cascade: 1 })
        .then(function (resposta) {
          Utils.notify.success(resposta.message || 'Registro removido.');
          return true;
        })
        .catch(function (e) { Utils.notify.error(e.message); return false; });
    });
  }

  return { run: run };
}());
