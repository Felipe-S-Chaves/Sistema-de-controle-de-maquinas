/**
 * Camada unica de comunicacao com a API.
 * Centraliza token, tratamento de erro e formato de resposta.
 */
window.Api = (function () {
  'use strict';

  var BASE_URL = '/api';
  var TOKEN_KEY = 'scm_token';
  var USER_KEY = 'scm_user';

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); }
    catch (e) { return null; }
  }

  function setSession(token, user, remember) {
    try {
      var store = remember ? localStorage : sessionStorage;
      store.setItem(TOKEN_KEY, token);
      store.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) { /* armazenamento indisponivel */ }
  }

  function getUser() {
    try {
      var raw = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
    } catch (e) { /* noop */ }
  }

  /** Erro da API ja traduzido para a interface. */
  function ApiError(message, code, details, status) {
    this.name = 'ApiError';
    this.message = message || 'Nao foi possivel completar a operacao.';
    this.code = code || 'UNKNOWN';
    this.details = details || null;
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function buildQuery(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === null || value === undefined || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function request(method, path, options) {
    options = options || {};
    var headers = {};
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    var body;
    if (options.formData) {
      body = options.formData;                 // o browser define o boundary
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    var url = BASE_URL + path + buildQuery(options.params);

    return fetch(url, { method: method, headers: headers, body: body })
      .then(function (response) {
        if (response.status === 401) {
          clearSession();
          if (!/\/login\.html$/.test(window.location.pathname)) {
            window.location.replace('/login.html?expired=1');
          }
          throw new ApiError('Sua sessao expirou. Faca login novamente.', 'UNAUTHORIZED', null, 401);
        }

        // Senha temporaria: o backend fecha tudo ate a troca. Em vez de mostrar
        // o erro em cada tela, mandamos a pessoa para onde ela resolve isso.
        if (response.status === 403 && !/\/change-password\.html$/.test(window.location.pathname)) {
          var tipo = response.headers.get('content-type') || '';
          if (tipo.indexOf('application/json') !== -1) {
            return response.json().then(function (corpo) {
              if (corpo && corpo.error === 'PASSWORD_CHANGE_REQUIRED') {
                window.location.replace('/change-password.html?required=1');
              }
              throw new ApiError(corpo.message, corpo.error, corpo.details, 403);
            });
          }
        }

        var contentType = response.headers.get('content-type') || '';

        if (contentType.indexOf('application/json') === -1) {
          if (!response.ok) {
            throw new ApiError('Nao foi possivel completar a operacao.', 'HTTP_' + response.status, null, response.status);
          }
          return response.blob();
        }

        return response.json().then(function (payload) {
          if (!response.ok || payload.success === false) {
            throw new ApiError(payload.message, payload.error, payload.details, response.status);
          }
          return payload;
        });
      })
      .catch(function (error) {
        if (error instanceof ApiError || error.name === 'ApiError') throw error;
        throw new ApiError(
          'Nao foi possivel conectar ao servidor. Verifique sua conexao.',
          'NETWORK_ERROR', null, 0
        );
      });
  }

  return {
    ApiError: ApiError,
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,

    /** Atualiza os dados do usuario guardado, mantendo o token e onde ele esta. */
    updateUser: function (user) {
      try {
        var store = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
        store.setItem(USER_KEY, JSON.stringify(user));
      } catch (e) { /* armazenamento indisponivel */ }
    },

    clearSession: clearSession,
    isAuthenticated: function () { return !!getToken(); },

    /** O usuario logado tem esta permissao? Espelha config/permissions.js do backend. */
    can: function (permissao) {
      var user = getUser();
      return !!(user && Array.isArray(user.permissions) && user.permissions.indexOf(permissao) !== -1);
    },

    /**
     * Tela inicial do usuario conforme o perfil.
     * O operador nao tem dashboard: ele cai direto na nova coleta,
     * que e o trabalho dele no dia a dia.
     */
    homePage: function () {
      return this.can('dashboard.full') ? '/index.html' : '/collection-new.html';
    },

    /** Papel do usuario logado. */
    role: function () {
      var user = getUser();
      return user ? user.role : null;
    },

    get: function (path, params) { return request('GET', path, { params: params }); },
    post: function (path, body, params) { return request('POST', path, { body: body, params: params }); },
    put: function (path, body) { return request('PUT', path, { body: body }); },
    patch: function (path, body) { return request('PATCH', path, { body: body }); },
    del: function (path, params) { return request('DELETE', path, { params: params }); },
    upload: function (path, formData) { return request('POST', path, { formData: formData }); },
    uploadPut: function (path, formData) { return request('PUT', path, { formData: formData }); },

    /** Baixa um arquivo autenticado (PDF, imagem). */
    download: function (path, params, filename) {
      return request('GET', path, { params: params }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename || 'download.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      });
    },

    /**
     * Carrega uma imagem protegida em um <img>.
     * O token vai no header (nunca na URL, que acabaria em logs e historico).
     *
     * Aceita o id de uma imagem de coleta ou um caminho completo da API -
     * e o caso da foto do documento do cliente.
     */
    loadImageInto: function (imgElement, imageIdOuCaminho) {
      var caminho = String(imageIdOuCaminho).charAt(0) === '/'
        ? imageIdOuCaminho
        : '/collections/images/' + imageIdOuCaminho;

      return request('GET', caminho).then(function (blob) {
        var url = URL.createObjectURL(blob);
        imgElement.src = url;
        imgElement.addEventListener('load', function () {
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }, { once: true });
        return url;
      });
    },

    /** Baixa o comprovante em PDF de uma coleta. */
    downloadReceipt: function (collectionId) {
      var nome = 'comprovante-coleta-' + String(collectionId).padStart(6, '0') + '.pdf';
      return this.download('/collections/' + collectionId + '/receipt', null, nome);
    },

    /** Baixa o arquivo original de uma imagem da coleta. */
    downloadImage: function (imageId, filename) {
      return this.download('/collections/images/' + imageId, { download: 1 }, filename || 'comprovante.jpg');
    }
  };
}());
