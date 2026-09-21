/**
 * Nova coleta - fluxo otimizado para uso em celular no local da maquina.
 *
 * CLIENTE -> MAQUINA -> ULTIMA LEITURA -> NOVA ENTRADA -> NOVA SAIDA
 * -> CALCULO -> FOTO -> OBSERVACAO -> SALVAR
 *
 * O calculo aqui e apenas feedback imediato. O backend recalcula tudo
 * e e a autoridade final sobre os valores gravados.
 */
(function () {
  'use strict';

  var state = {
    owners: [],
    machineId: null,
    isFirstCollection: false,
    previousEntryCents: 0,
    previousExitCents: 0,
    photos: []              // { file, url }
  };

  var form;

  document.addEventListener('DOMContentLoaded', function () {
    if (!Api.isAuthenticated()) return;

    form = document.getElementById('collectionForm');

    loadOwners();
    bindOwnerStep();
    bindMachineStep();
    bindReadingInputs();
    bindPhotos();
    form.addEventListener('submit', onSubmit);

    renderCalculation();

    // Maquina pre-selecionada via ?machine_id= (util para QR Code futuro).
    var preset = Utils.queryParam('machine_id');
    if (preset) preselectMachine(preset);
  });

  // ------------------------------------------------------------------
  // Passo 1: cliente
  // ------------------------------------------------------------------
  function loadOwners() {
    return Api.get('/owners', { pageSize: 100, status: 'active' })
      .then(function (payload) {
        state.owners = payload.data;
        renderOwnerOptions('');
      })
      .catch(function (error) { Utils.notify.error(error.message); });
  }

  function renderOwnerOptions(filter) {
    var select = document.getElementById('ownerSelect');
    var current = select.value;
    var term = (filter || '').toLowerCase();

    var options = state.owners
      .filter(function (o) { return !term || o.name.toLowerCase().indexOf(term) !== -1; })
      .map(function (o) {
        return '<option value="' + o.id + '">' + Utils.escapeHtml(o.name) + '</option>';
      }).join('');

    select.innerHTML = '<option value="">Selecione o cliente</option>' + options;
    if (current) select.value = current;
  }

  function bindOwnerStep() {
    document.getElementById('ownerSearch').addEventListener('input', Utils.debounce(function (e) {
      renderOwnerOptions(e.target.value.trim());
    }, 200));

    document.getElementById('ownerSelect').addEventListener('change', function (e) {
      var ownerId = e.target.value;
      resetFromMachine();
      if (!ownerId) {
        document.getElementById('stepMachine').classList.add('is-disabled');
        return;
      }
      loadMachines(ownerId);
    });
  }

  // ------------------------------------------------------------------
  // Passo 2: maquina
  // ------------------------------------------------------------------
  function loadMachines(ownerId) {
    var select = document.getElementById('machineSelect');
    select.innerHTML = '<option value="">Carregando...</option>';
    document.getElementById('stepMachine').classList.remove('is-disabled');

    return Api.get('/owners/' + ownerId + '/machines')
      .then(function (payload) {
        var machines = payload.data;
        if (!machines.length) {
          select.innerHTML = '<option value="">Este cliente nao possui maquinas</option>';
          Utils.notify.warning('Este cliente ainda nao possui maquinas cadastradas.');
          return;
        }
        select.innerHTML = '<option value="">Selecione a maquina</option>' +
          machines.map(function (m) {
            return '<option value="' + m.id + '" data-status="' + m.status + '">' +
              Utils.escapeHtml(m.number + ' - ' + m.name) + '</option>';
          }).join('');
      })
      .catch(function (error) {
        select.innerHTML = '<option value="">Erro ao carregar</option>';
        Utils.notify.error(error.message);
      });
  }

  function bindMachineStep() {
    document.getElementById('machineSelect').addEventListener('change', function (e) {
      var machineId = e.target.value;
      resetFromMachine();
      if (!machineId) return;

      var option = e.target.selectedOptions[0];
      var hint = document.getElementById('machineStatusHint');
      hint.innerHTML = option.getAttribute('data-status') === 'maintenance'
        ? '<div class="alert alert-warning py-2 px-3 small mb-0">Esta maquina esta em <strong>manutencao</strong>. A coleta pode ser registrada normalmente.</div>'
        : '';

      state.machineId = machineId;
      loadLastReading(machineId);
    });
  }

  function preselectMachine(machineId) {
    Api.get('/machines/' + machineId)
      .then(function (payload) {
        var machine = payload.data;
        document.getElementById('ownerSelect').value = machine.owner_id;
        return loadMachines(machine.owner_id).then(function () {
          var select = document.getElementById('machineSelect');
          select.value = machine.id;
          select.dispatchEvent(new Event('change'));
        });
      })
      .catch(function () { /* segue o fluxo manual */ });
  }

  // ------------------------------------------------------------------
  // Passo 3: ultima leitura (somente referencia, nunca editavel)
  // ------------------------------------------------------------------
  function loadLastReading(machineId) {
    var box = document.getElementById('lastReadingBox');
    document.getElementById('stepLastReading').classList.remove('is-disabled');
    Utils.renderLoading(box, 1);

    Api.get('/machines/' + machineId + '/last-reading')
      .then(function (payload) {
        var data = payload.data;
        state.isFirstCollection = data.is_first_collection;

        var firstNotice = document.getElementById('firstCollectionNotice');
        var firstFields = document.getElementById('firstPreviousFields');

        if (data.is_first_collection) {
          state.previousEntryCents = 0;
          state.previousExitCents = 0;

          box.innerHTML =
            '<div class="alert alert-info py-2 px-3 mb-0 small">' +
            'Esta maquina ainda nao possui coletas. Esta sera a <strong>primeira leitura</strong> ' +
            'e servira de marco inicial.</div>';

          firstNotice.classList.remove('d-none');
          firstFields.classList.remove('d-none');
          document.getElementById('previousEntry').value = '';
          document.getElementById('previousExit').value = '';
          atualizarEco('previousEntry');
          atualizarEco('previousExit');
        } else {
          state.previousEntryCents = Utils.toCents(data.last_collection.entry_value) || 0;
          state.previousExitCents = Utils.toCents(data.last_collection.exit_value) || 0;

          // O numero cru vem primeiro: e ele que o operador compara com o
          // visor da maquina, parado na frente dela. O valor em reais fica
          // logo abaixo, para conferencia.
          box.innerHTML =
            '<div class="row g-2">' +
            '  <div class="col-6"><div class="reading-box">' +
            '    <div class="reading-label">Entrada</div>' +
            '    <div class="reading-value">' + Utils.centsToReading(state.previousEntryCents) + '</div>' +
            '    <div class="small text-muted">' + Utils.centsToMoney(state.previousEntryCents) + '</div>' +
            '  </div></div>' +
            '  <div class="col-6"><div class="reading-box">' +
            '    <div class="reading-label">Saida</div>' +
            '    <div class="reading-value">' + Utils.centsToReading(state.previousExitCents) + '</div>' +
            '    <div class="small text-muted">' + Utils.centsToMoney(state.previousExitCents) + '</div>' +
            '  </div></div>' +
            '  <div class="col-12"><p class="text-muted small mb-0 mt-1">' +
            'Ultima coleta em ' + Utils.formatDateTime(data.last_collection.collected_at) +
            '. Estes valores sao apenas referencia e nao podem ser editados aqui.</p></div>' +
            '</div>';

          firstNotice.classList.add('d-none');
          firstFields.classList.add('d-none');
        }

        ['stepNewReading', 'stepPhotos', 'stepObservation'].forEach(function (id) {
          document.getElementById(id).classList.remove('is-disabled');
        });

        renderCalculation();
        document.getElementById('currentEntry').focus();
      })
      .catch(function (error) {
        Utils.renderError(box, error.message, function () { loadLastReading(machineId); });
      });
  }

  function resetFromMachine() {
    state.machineId = null;
    state.isFirstCollection = false;
    state.previousEntryCents = 0;
    state.previousExitCents = 0;

    ['stepLastReading', 'stepNewReading', 'stepPhotos', 'stepObservation'].forEach(function (id) {
      document.getElementById(id).classList.add('is-disabled');
    });
    document.getElementById('lastReadingBox').innerHTML =
      '<p class="text-muted small mb-0">Selecione uma maquina para ver a ultima leitura.</p>';
    document.getElementById('machineStatusHint').innerHTML = '';
    limparLeituras();
    document.getElementById('exceptionBox').classList.add('d-none');
    document.getElementById('confirmException').checked = false;
    document.getElementById('exceptionReason').value = '';
    renderCalculation();
  }

  // ------------------------------------------------------------------
  // Passos 4 e 5: nova leitura + calculo em tempo real
  // ------------------------------------------------------------------
  /**
   * Os relogios sao digitados como aparecem na maquina: so digitos.
   *
   * Qualquer caractere que nao seja numero e removido na hora, entao nao ha
   * como o operador inventar um ponto ou uma virgula e receber um valor cem
   * vezes menor. Abaixo de cada campo, o mesmo numero aparece em reais - e a
   * conferencia que ele faz antes de salvar.
   */
  function bindReadingInputs() {
    ['currentEntry', 'currentExit', 'previousEntry', 'previousExit'].forEach(function (id) {
      var input = document.getElementById(id);

      input.addEventListener('input', function () {
        var limpo = Utils.readingDigits(input.value);
        if (input.value !== limpo) {
          // Mantem o cursor no fim: quem digita rapido no celular nao pode
          // ver o cursor pular para o comeco a cada caractere recusado.
          input.value = limpo;
          try { input.setSelectionRange(limpo.length, limpo.length); } catch (e) { /* noop */ }
        }
        input.classList.remove('is-invalid');
        atualizarEco(id);
        renderCalculation();
      });
    });

    document.getElementById('confirmException').addEventListener('change', renderCalculation);
    document.getElementById('exceptionReason').addEventListener('input', renderCalculation);
  }

  /** Espelha o campo em reais, logo abaixo dele. */
  function atualizarEco(id) {
    var eco = document.querySelector('[data-echo-for="' + id + '"]');
    if (!eco) return;
    var cents = Utils.readingToCents(document.getElementById(id).value);
    eco.textContent = Utils.centsToMoney(cents || 0);
    eco.classList.toggle('text-muted', cents === null);
  }

  function limparLeituras() {
    ['currentEntry', 'currentExit', 'previousEntry', 'previousExit'].forEach(function (id) {
      var campo = document.getElementById(id);
      if (campo) { campo.value = ''; atualizarEco(id); }
    });
  }

  function currentPreviousCents() {
    if (!state.isFirstCollection) {
      return { entry: state.previousEntryCents, exit: state.previousExitCents };
    }
    return {
      entry: Utils.readingToCents(document.getElementById('previousEntry').value) || 0,
      exit: Utils.readingToCents(document.getElementById('previousExit').value) || 0
    };
  }

  /**
   * Regra financeira (espelho do backend, apenas para feedback):
   *   entrada apurada = entrada atual - entrada anterior
   *   saida apurada   = saida atual   - saida anterior
   *   VALOR BRUTO     = entrada apurada - saida apurada
   *
   * As duas apuracoes mostram a conta em digitos, do jeito que os numeros
   * estao no visor da maquina. O valor bruto ja trabalha com os resultados
   * delas, entao ali a conta aparece em reais. O servidor recalcula tudo
   * antes de gravar.
   */
  function renderCalculation() {
    var box = document.getElementById('calculationBox');
    var entryCents = Utils.readingToCents(document.getElementById('currentEntry').value);
    var exitCents = Utils.readingToCents(document.getElementById('currentExit').value);
    var previous = currentPreviousCents();

    var hasBoth = entryCents !== null && exitCents !== null;

    if (!state.machineId || !hasBoth) {
      box.innerHTML =
        '<div class="result-box">' +
        '  <div class="result-line">Valor bruto</div>' +
        '  <div class="result-value">R$ 0,00</div>' +
        '  <div class="result-line mt-2">Informe os dois relogios para ver o calculo.</div>' +
        '</div>';
      updateExceptionBox(null, null);
      updateSaveButton(false);
      return;
    }

    var calcEntry = entryCents - previous.entry;
    var calcExit = exitCents - previous.exit;
    var total = calcEntry - calcExit;

    // "285000 - 280900" - a conta escrita como o operador a faria no papel.
    var conta = function (a, b) {
      return Utils.centsToReading(a) + ' &minus; ' + Utils.centsToReading(b);
    };

    box.innerHTML =
      '<div class="row g-2 mb-3">' +
      '  <div class="col-6"><div class="reading-box">' +
      '    <div class="reading-label">Entrada apurada</div>' +
      '    <div class="reading-value">' + Utils.centsToMoney(calcEntry) + '</div>' +
      '    <div class="small text-muted">' + conta(entryCents, previous.entry) + '</div>' +
      '  </div></div>' +
      '  <div class="col-6"><div class="reading-box">' +
      '    <div class="reading-label">Saida apurada</div>' +
      '    <div class="reading-value">' + Utils.centsToMoney(calcExit) + '</div>' +
      '    <div class="small text-muted">' + conta(exitCents, previous.exit) + '</div>' +
      '  </div></div>' +
      '</div>' +
      '<div class="result-box">' +
      '  <div class="result-line">Valor bruto</div>' +
      '  <div class="result-value">' + Utils.centsToMoney(total) + '</div>' +
      '  <div class="result-line mt-2">' +
      Utils.centsToMoney(calcEntry) + ' &minus; ' + Utils.centsToMoney(calcExit) + '</div>' +
      '</div>' +
      '<p class="text-muted small mb-0 mt-2">O servidor recalcula estes valores antes de salvar.</p>';

    updateExceptionBox(entryCents - previous.entry, exitCents - previous.exit);

    var backwards = calcEntry < 0 || calcExit < 0;
    var exceptionOk = !backwards ||
      (document.getElementById('confirmException').checked &&
        document.getElementById('exceptionReason').value.trim().length >= 10);

    // A foto e opcional: o que ainda trava o salvar e uma excecao de leitura
    // sem motivo informado.
    updateSaveButton(exceptionOk);
  }

  function updateExceptionBox(calcEntry, calcExit) {
    var box = document.getElementById('exceptionBox');
    if (calcEntry === null || (calcEntry >= 0 && calcExit >= 0)) {
      box.classList.add('d-none');
      return;
    }

    var messages = [];
    if (calcEntry < 0) messages.push('A nova leitura de entrada e MENOR que a leitura anterior.');
    if (calcExit < 0) messages.push('A nova leitura de saida e MENOR que a leitura anterior.');
    messages.push('Verifique o valor informado. Se estiver correto, confirme a excecao com o motivo.');

    document.getElementById('exceptionMessage').textContent = messages.join(' ');
    box.classList.remove('d-none');
  }

  function updateSaveButton(enabled) {
    document.getElementById('btnSaveCollection').disabled = !enabled;
  }

  // ------------------------------------------------------------------
  // Passo 6: fotos
  // ------------------------------------------------------------------
  var MAX_FOTOS = 8;
  var LADO_MAXIMO = 1600;   // px - suficiente para ler o visor do relogio
  var QUALIDADE = 0.82;

  /** A compressao vive em Utils: a tela de cliente usa a mesma. */
  function comprimirImagem(file) {
    return Utils.comprimirImagem(file, { ladoMaximo: LADO_MAXIMO, qualidade: QUALIDADE });
  }

  function tamanhoLegivel(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }

  async function adicionarArquivos(lista) {
    var hint = document.getElementById('photoHint');
    var aceitos = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    var arquivos = Array.prototype.slice.call(lista);
    if (!arquivos.length) return;

    hint.className = 'form-text text-muted';
    hint.textContent = 'Preparando ' + arquivos.length + ' foto(s)...';

    for (var i = 0; i < arquivos.length; i += 1) {
      var file = arquivos[i];

      if (state.photos.length >= MAX_FOTOS) {
        Utils.notify.warning('Limite de ' + MAX_FOTOS + ' fotos por coleta.');
        break;
      }
      // Alguns Android reportam type vazio em foto da camera: aceitamos pela extensao.
      var tipoOk = !file.type || aceitos.indexOf(file.type) !== -1 || /^image\//.test(file.type);
      if (!tipoOk) {
        Utils.notify.error('"' + file.name + '" nao e uma imagem.');
        continue;
      }

      var original = file.size;
      // eslint-disable-next-line no-await-in-loop
      var pronta = await comprimirImagem(file);

      if (pronta.size > 8 * 1024 * 1024) {
        Utils.notify.error('"' + file.name + '" continua acima de 8 MB e nao foi adicionada.');
        continue;
      }

      state.photos.push({
        file: pronta,
        url: URL.createObjectURL(pronta),
        original: original,
        final: pronta.size
      });
    }

    var total = state.photos.reduce(function (soma, p) { return soma + p.final; }, 0);
    hint.className = 'form-text text-muted';
    hint.textContent = state.photos.length
      ? state.photos.length + ' foto(s) - ' + tamanhoLegivel(total) + ' para enviar'
      : '';

    renderPhotos();
    renderCalculation();
  }

  function bindPhotos() {
    var camera = document.getElementById('cameraInput');
    var galeria = document.getElementById('galleryInput');

    document.getElementById('btnTakePhoto').addEventListener('click', function () { camera.click(); });
    document.getElementById('btnPickPhoto').addEventListener('click', function () { galeria.click(); });

    [camera, galeria].forEach(function (input) {
      input.addEventListener('change', function () {
        // input.files e uma lista VIVA: limpar o value esvazia a lista.
        // Por isso copiamos os arquivos para um array antes de limpar.
        var arquivos = Array.prototype.slice.call(input.files);
        input.value = '';   // permite tirar outra foto igual em seguida
        adicionarArquivos(arquivos);
      });
    });
  }

  function renderPhotos() {
    var grid = document.getElementById('photoPreview');
    grid.innerHTML = state.photos.map(function (photo, index) {
      return '<div class="photo-thumb">' +
        '<img src="' + photo.url + '" alt="Pre-visualizacao ' + (index + 1) + '">' +
        '<button type="button" class="btn-remove" data-remove="' + index + '" aria-label="Remover foto">&times;</button>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var index = Number(btn.getAttribute('data-remove'));
        URL.revokeObjectURL(state.photos[index].url);
        state.photos.splice(index, 1);
        renderPhotos();
        renderCalculation();
      });
    });

    var slot = form.querySelector('[data-error-for="images"]');
    if (slot) slot.textContent = state.photos.length ? '' : slot.textContent;
  }

  // ------------------------------------------------------------------
  // Salvar
  // ------------------------------------------------------------------
  function onSubmit(event) {
    event.preventDefault();
    Utils.clearFieldErrors(form);

    var errors = {};
    if (!document.getElementById('ownerSelect').value) errors.owner_id = 'Selecione o cliente.';
    if (!state.machineId) errors.machine_id = 'Selecione a maquina.';
    if (Utils.readingToCents(document.getElementById('currentEntry').value) === null) {
      errors.current_entry_value = 'Informe o novo relogio de entrada.';
    }
    if (Utils.readingToCents(document.getElementById('currentExit').value) === null) {
      errors.current_exit_value = 'Informe o novo relogio de saida.';
    }

    if (Object.keys(errors).length) {
      Utils.applyFieldErrors(form, errors);
      Utils.notify.error('Verifique os campos obrigatorios antes de salvar.');
      return;
    }

    var button = document.getElementById('btnSaveCollection');
    Utils.setButtonLoading(button, true, 'Enviando fotos...');

    var data = new FormData();
    data.append('machine_id', state.machineId);
    // Os digitos do visor viram reais inteiros: 280900 vai como "280900.00".
    var leitura = function (id) {
      return String((Utils.readingToCents(document.getElementById(id).value) || 0) / 100);
    };

    data.append('current_entry_value', leitura('currentEntry'));
    data.append('current_exit_value', leitura('currentExit'));

    if (state.isFirstCollection) {
      data.append('previous_entry_value', leitura('previousEntry'));
      data.append('previous_exit_value', leitura('previousExit'));
    }

    if (document.getElementById('confirmException').checked) {
      data.append('confirm_exception', 'true');
      data.append('exception_reason', document.getElementById('exceptionReason').value.trim());
    }

    var observation = document.getElementById('observation').value.trim();
    if (observation) data.append('observation', observation);

    state.photos.forEach(function (photo) { data.append('images', photo.file, photo.file.name); });

    Api.upload('/collections', data)
      .then(function (payload) {
        Utils.notify.success('Coleta registrada com sucesso.');
        state.photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
        window.location.href = '/collection-detail.html?id=' + payload.data.id + '&created=1';
      })
      .catch(function (error) {
        Utils.setButtonLoading(button, false);

        if (error.code === 'READING_LOWER_THAN_PREVIOUS') {
          document.getElementById('exceptionBox').classList.remove('d-none');
          document.getElementById('exceptionMessage').textContent = error.message;
          document.getElementById('exceptionBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
          Utils.notify.warning(error.message);
          return;
        }

        Utils.handleApiError(error, form);
      });
  }
}());
