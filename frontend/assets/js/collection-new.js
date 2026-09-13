/**
 * Nova coleta - fluxo otimizado para uso em celular no local da maquina.
 *
 * PROPRIETARIO -> MAQUINA -> ULTIMA LEITURA -> NOVA ENTRADA -> NOVA SAIDA
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
  // Passo 1: proprietario
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

    select.innerHTML = '<option value="">Selecione o proprietario</option>' + options;
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
          select.innerHTML = '<option value="">Este proprietario nao possui maquinas</option>';
          Utils.notify.warning('Este proprietario ainda nao possui maquinas cadastradas.');
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
        } else {
          state.previousEntryCents = Utils.toCents(data.last_collection.entry_value) || 0;
          state.previousExitCents = Utils.toCents(data.last_collection.exit_value) || 0;

          box.innerHTML =
            '<div class="row g-2">' +
            '  <div class="col-6"><div class="reading-box">' +
            '    <div class="reading-label">Entrada</div>' +
            '    <div class="reading-value">' + Utils.formatMoney(data.last_collection.entry_value) + '</div>' +
            '  </div></div>' +
            '  <div class="col-6"><div class="reading-box">' +
            '    <div class="reading-label">Saida</div>' +
            '    <div class="reading-value">' + Utils.formatMoney(data.last_collection.exit_value) + '</div>' +
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
    document.getElementById('currentEntry').value = '';
    document.getElementById('currentExit').value = '';
    document.getElementById('exceptionBox').classList.add('d-none');
    document.getElementById('confirmException').checked = false;
    document.getElementById('exceptionReason').value = '';
    renderCalculation();
  }

  // ------------------------------------------------------------------
  // Passos 4 e 5: nova leitura + calculo em tempo real
  // ------------------------------------------------------------------
  function bindReadingInputs() {
    ['currentEntry', 'currentExit', 'previousEntry', 'previousExit'].forEach(function (id) {
      var input = document.getElementById(id);
      input.addEventListener('input', function () {
        input.classList.remove('is-invalid');
        renderCalculation();
      });
      input.addEventListener('blur', function () {
        var cents = Utils.toCents(input.value);
        if (cents !== null) input.value = (cents / 100).toFixed(2).replace('.', ',');
      });
    });

    document.getElementById('confirmException').addEventListener('change', renderCalculation);
    document.getElementById('exceptionReason').addEventListener('input', renderCalculation);
  }

  function currentPreviousCents() {
    if (!state.isFirstCollection) {
      return { entry: state.previousEntryCents, exit: state.previousExitCents };
    }
    return {
      entry: Utils.toCents(document.getElementById('previousEntry').value) || 0,
      exit: Utils.toCents(document.getElementById('previousExit').value) || 0
    };
  }

  /**
   * Regra financeira (espelho do backend, apenas para feedback):
   *   entrada apurada = entrada atual - entrada anterior
   *   saida apurada   = saida atual   - saida anterior
   *   apurado         = entrada apurada - saida apurada
   */
  function renderCalculation() {
    var box = document.getElementById('calculationBox');
    var entryCents = Utils.toCents(document.getElementById('currentEntry').value);
    var exitCents = Utils.toCents(document.getElementById('currentExit').value);
    var previous = currentPreviousCents();

    var hasBoth = entryCents !== null && exitCents !== null;

    if (!state.machineId || !hasBoth) {
      box.innerHTML =
        '<div class="result-box">' +
        '  <div class="result-line">Valor apurado</div>' +
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

    box.innerHTML =
      '<div class="row g-2 mb-3">' +
      '  <div class="col-6"><div class="reading-box">' +
      '    <div class="reading-label">Entrada apurada</div>' +
      '    <div class="reading-value">' + Utils.centsToMoney(calcEntry) + '</div>' +
      '    <div class="small text-muted">' + Utils.centsToMoney(entryCents) + ' &minus; ' +
      Utils.centsToMoney(previous.entry) + '</div>' +
      '  </div></div>' +
      '  <div class="col-6"><div class="reading-box">' +
      '    <div class="reading-label">Saida apurada</div>' +
      '    <div class="reading-value">' + Utils.centsToMoney(calcExit) + '</div>' +
      '    <div class="small text-muted">' + Utils.centsToMoney(exitCents) + ' &minus; ' +
      Utils.centsToMoney(previous.exit) + '</div>' +
      '  </div></div>' +
      '</div>' +
      '<div class="result-box">' +
      '  <div class="result-line">Valor apurado</div>' +
      '  <div class="result-value">' + Utils.centsToMoney(total) + '</div>' +
      '  <div class="result-line mt-2">' +
      Utils.centsToMoney(calcEntry) + ' &minus; ' + Utils.centsToMoney(calcExit) +
      '  </div>' +
      '</div>' +
      '<p class="text-muted small mb-0 mt-2">O servidor recalcula estes valores antes de salvar.</p>';

    updateExceptionBox(entryCents - previous.entry, exitCents - previous.exit);

    var backwards = calcEntry < 0 || calcExit < 0;
    var exceptionOk = !backwards ||
      (document.getElementById('confirmException').checked &&
        document.getElementById('exceptionReason').value.trim().length >= 10);

    updateSaveButton(state.photos.length > 0 && exceptionOk);
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
  function bindPhotos() {
    var input = document.getElementById('photoInput');
    document.getElementById('btnTakePhoto').addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var maxBytes = 8 * 1024 * 1024;
      Array.prototype.forEach.call(input.files, function (file) {
        if (state.photos.length >= 8) {
          Utils.notify.warning('Limite de 8 fotos por coleta.');
          return;
        }
        if (file.size > maxBytes) {
          Utils.notify.error('"' + file.name + '" tem mais de 8 MB e nao foi adicionada.');
          return;
        }
        if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) {
          Utils.notify.error('"' + file.name + '" nao e um formato de imagem aceito (JPG, PNG ou WEBP).');
          return;
        }
        state.photos.push({ file: file, url: URL.createObjectURL(file) });
      });
      input.value = '';
      renderPhotos();
      renderCalculation();
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
    if (!document.getElementById('ownerSelect').value) errors.owner_id = 'Selecione o proprietario.';
    if (!state.machineId) errors.machine_id = 'Selecione a maquina.';
    if (Utils.toCents(document.getElementById('currentEntry').value) === null) {
      errors.current_entry_value = 'Informe o novo relogio de entrada.';
    }
    if (Utils.toCents(document.getElementById('currentExit').value) === null) {
      errors.current_exit_value = 'Informe o novo relogio de saida.';
    }
    if (!state.photos.length) errors.images = 'Adicione pelo menos uma foto.';

    if (Object.keys(errors).length) {
      Utils.applyFieldErrors(form, errors);
      Utils.notify.error('Verifique os campos obrigatorios antes de salvar.');
      return;
    }

    var button = document.getElementById('btnSaveCollection');
    Utils.setButtonLoading(button, true, 'Enviando fotos...');

    var data = new FormData();
    data.append('machine_id', state.machineId);
    data.append('current_entry_value', String(Utils.toCents(document.getElementById('currentEntry').value) / 100));
    data.append('current_exit_value', String(Utils.toCents(document.getElementById('currentExit').value) / 100));

    if (state.isFirstCollection) {
      data.append('previous_entry_value', String((Utils.toCents(document.getElementById('previousEntry').value) || 0) / 100));
      data.append('previous_exit_value', String((Utils.toCents(document.getElementById('previousExit').value) || 0) / 100));
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
