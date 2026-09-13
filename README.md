# Sistema de Controle de Máquinas de Música

Aplicação web para gestão operacional e financeira de máquinas de música:
proprietários, máquinas, coletas com dois relógios, comprovantes fotográficos,
histórico imutável, auditoria, relatórios e PDF.

**Stack:** Node.js + Express + MySQL2 (backend) · HTML5 + CSS3 + JavaScript + Bootstrap 5 (frontend) · JWT + Bcrypt + CORS (segurança)

---

## Sumário

- [Instalação](#instalação)
- [Executando](#executando)
- [A regra financeira](#a-regra-financeira)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Banco de dados](#banco-de-dados)
- [API](#api)
- [Testes](#testes)
- [Segurança](#segurança)
- [Decisões técnicas](#decisões-técnicas)
- [Evolução futura](#evolução-futura)

---

## Instalação

### Pré-requisitos

- **Node.js 18 ou superior** — <https://nodejs.org>
- **MySQL 8** ou **MariaDB 10.4+** instalado e rodando

### Três comandos

```bash
npm install
copy .env.example .env      # Linux/Mac: cp .env.example .env
npm run setup
```

O `npm run setup` faz tudo: cria o banco principal, o banco de testes, o usuário
da aplicação, as tabelas e o administrador do sistema.

Ele tenta descobrir sozinho um acesso administrativo ao MySQL. Se o seu MySQL
tem senha no `root` (o padrão do instalador oficial no Windows), ele pergunta
uma vez — é a senha que você definiu **quando instalou o MySQL**. Ela é usada só
naquele momento e não é gravada em nenhum arquivo.

Depois:

```bash
npm start
```

E abra <http://localhost:3000>.

### O que ajustar no `.env`

O arquivo já vem pronto para desenvolvimento. Vale mexer em:

| Variável | Para quê |
|---|---|
| `DB_USER` / `DB_PASSWORD` | O usuário que a aplicação vai usar. Se o usuário ainda não existe no MySQL, o `npm run setup` cria com essa senha |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Login do administrador do sistema |
| `JWT_SECRET` | **Troque antes de usar de verdade.** Ele assina os tokens de sessão |

Gere um `JWT_SECRET` seguro:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Sobre `DB_PASSWORD`:** se você deixar `DB_USER=root`, a senha precisa ser a
> que o MySQL já tem para o root. Se preferir escolher a senha, use um usuário
> próprio: coloque `DB_USER=meu_usuario` e a senha desejada — o `npm run setup`
> cria esse usuário para você.

### Se algo der errado

```bash
npm run db:check
```

Testa a conexão e aponta a causa exata: MySQL parado, senha incorreta, usuário
que conecta sem senha, senha cortada por caractere especial ou falta de
permissão.

<details>
<summary>Esqueci a senha do root do MySQL</summary>

No Windows, abra o **MySQL Installer** (não o Workbench) → **MySQL Server** →
**Reconfigure** e defina uma senha nova. Depois rode `npm run setup`.

</details>

<details>
<summary>Prefiro criar o banco à mão</summary>

```sql
CREATE DATABASE music_machines CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE music_machines_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'mm_user'@'localhost' IDENTIFIED BY 'SUA_SENHA_FORTE';
GRANT ALL PRIVILEGES ON music_machines.* TO 'mm_user'@'localhost';
GRANT ALL PRIVILEGES ON music_machines_test.* TO 'mm_user'@'localhost';
FLUSH PRIVILEGES;
```

Aponte `DB_USER` e `DB_PASSWORD` no `.env` para esse usuário e rode
`npm run migrate && npm run seed`.

</details>

### Comandos disponíveis

| Comando | O que faz |
|---|---|
| `npm run setup` | Instalação completa (banco + tabelas + administrador) |
| `npm start` | Inicia o servidor |
| `npm run dev` | Inicia com reinício automático ao salvar arquivos |
| `npm run db:check` | Diagnostica a conexão com o MySQL |
| `npm run db:setup` | Só prepara banco e usuário |
| `npm run migrate` | Só cria/atualiza as tabelas |
| `npm run seed` | Só cria o administrador (`--demo` inclui dados de exemplo) |
| `npm run reset` | **Apaga tudo** e recria do zero |
| `npm test` | Roda os 89 testes automatizados |

## Executando

```bash
npm start           # produção
npm run dev         # desenvolvimento, com reinício automático
```

Acesse **<http://localhost:3000>** e entre com as credenciais do `.env`.

> Na primeira entrada, troque a senha do administrador pelo menu do usuário →
> **Alterar senha**.

Para usar do celular na mesma rede, descubra o IP da máquina
(`ipconfig` no Windows) e acesse `http://SEU_IP:3000`.

---

## A regra financeira

Esta é a regra central do sistema e **não pode ser alterada**.

Cada máquina tem **dois contadores acumulados e independentes**:

- **Relógio de entrada** — total já inserido na máquina
- **Relógio de saída** — total já pago pela máquina

Cada coleta registra a leitura atual dos dois e calcula:

```
Entrada apurada = entrada atual − entrada anterior
Saída apurada   = saída atual   − saída anterior
Valor apurado   = entrada apurada − saída apurada
```

**Nunca** `entrada atual − saída atual`.

### Exemplo

| | Anterior | Atual | Apurado |
|---|---|---|---|
| Entrada | R$ 7.200,00 | R$ 9.500,00 | **R$ 2.300,00** |
| Saída | R$ 5.100,00 | R$ 5.800,00 | **R$ 700,00** |
| | | **Valor apurado** | **R$ 1.600,00** |

### Garantias implementadas

| Garantia | Onde |
|---|---|
| A leitura anterior vem **sempre do banco**, nunca do formulário | `collectionService.js` |
| O backend **recalcula** todos os valores antes de gravar | `collectionCalculator.js` |
| O usuário **não digita** valores apurados | Não existem campos para isso |
| Toda a aritmética é feita em **centavos inteiros** | `utils/money.js` |
| Valores persistidos em `DECIMAL(14,2)`, nunca `FLOAT` | `schema.sql` |
| Cada coleta é um **registro novo**; histórico nunca é sobrescrito | `INSERT` apenas |
| Coleta cancelada **permanece** no histórico e **sai** dos totais | `status = 'cancelled'` |
| A leitura seguinte ignora coletas canceladas | `findLastConfirmed` |

### Primeira coleta

Uma máquina já instalada normalmente tem valor acumulado nos relógios. Na
**primeira coleta** — e só nela — o operador informa também a leitura anterior,
para que o apurado saia correto desde o início. Se os relógios estavam zerados,
basta deixar `0`.

### Leitura menor que a anterior

Se a nova leitura for menor que a anterior, o sistema **bloqueia** a gravação e
explica o problema. O operador pode corrigir o valor ou **confirmar a exceção
informando o motivo** (mínimo 10 caracteres). A exceção fica registrada na
coleta e na auditoria — nada é apagado ou sobrescrito.

---

## Estrutura do projeto

```
.
├── backend/
│   ├── config/          env.js (configuração validada) e database.js (pool MySQL2)
│   ├── controllers/     Recebem a requisição HTTP e devolvem a resposta
│   ├── services/        Regras de negócio e cálculo financeiro
│   ├── repositories/    Acesso ao MySQL com queries parametrizadas
│   ├── middlewares/     Autenticação, upload e tratamento de erros
│   ├── routes/          Definição dos endpoints
│   ├── validations/     Validador de entrada (CPF/CNPJ, dinheiro, enums)
│   ├── utils/           money, datetime, AppError, response
│   ├── database/        schema.sql, migrate.js, seed.js
│   ├── uploads/         Imagens gravadas em disco (fora do controle de versão)
│   ├── app.js           Montagem do Express
│   └── server.js        Inicialização e encerramento controlado
│
├── frontend/
│   ├── assets/
│   │   ├── css/app.css       Estilos próprios (Bootstrap é a base)
│   │   ├── js/               Um arquivo por tela + api.js, utils.js, layout.js
│   │   └── vendor/bootstrap/ Bootstrap local (sem CDN)
│   ├── login.html            Autenticação
│   ├── index.html            Dashboard
│   ├── owners.html           Proprietários
│   ├── owner-detail.html     Página do proprietário
│   ├── machines.html         Máquinas
│   ├── machine-detail.html   Página da máquina com histórico
│   ├── collections.html      Coletas
│   ├── collection-new.html   Nova coleta (otimizada para celular)
│   ├── collection-detail.html Detalhe da coleta e comprovantes
│   ├── reports.html          Relatórios e PDF
│   └── audit.html            Auditoria
│
├── tests/               Suítes automatizadas (ver tests/README.md)
├── scripts/             copy-vendor.js
├── .env.example
└── package.json
```

### Separação de responsabilidades no backend

```
Rota → Controller → Service → Repository → MySQL
```

- **Rota** — declara o endpoint e os middlewares
- **Controller** — lê a requisição, chama o service, devolve a resposta padronizada
- **Service** — concentra as regras de negócio; é a autoridade sobre os valores
- **Repository** — só conversa com o banco, sempre com queries parametrizadas

### Organização do frontend

`api.js` centraliza toda a comunicação HTTP (token, erros, uploads, download de
PDF). `utils.js` reúne formatação monetária e de datas, toasts, estados de
carregamento, paginação e o modal de confirmação. `layout.js` monta o cabeçalho,
o menu e a busca global. Cada tela tem seu próprio arquivo, sem um "arquivo
gigante" central.

---

## Banco de dados

| Tabela | Finalidade |
|---|---|
| `users` | Usuários e papéis (`admin`, `operator`, `viewer`) |
| `owners` | Proprietários — **não existe entidade "estabelecimento"** |
| `machines` | Máquinas, ligadas **diretamente** ao proprietário; `number` é único |
| `collections` | Coletas: leituras, valores apurados, status, exceções |
| `collection_images` | Comprovantes: caminho, nome original, MIME, tamanho, SHA-256 |
| `audit_logs` | Trilha de auditoria com valores antes/depois e motivo |
| `machine_transfers` | Preparada para transferência entre proprietários (fora do MVP) |
| `machine_revenue_splits` | Preparada para divisão percentual (fora do MVP) |

### Relacionamentos

```
owners  1 ──── N  machines  1 ──── N  collections  1 ──── N  collection_images
users   1 ──── N  collections
```

Todas as chaves estrangeiras usam `ON DELETE RESTRICT` nos vínculos financeiros:
**nada que tenha histórico pode ser apagado silenciosamente.**

### Índices

`collections` tem índices compostos por `(machine_id, collected_at)`,
`(owner_id, collected_at)` e `(status, collected_at)`, que atendem tanto o
histórico da máquina quanto os relatórios por período.

---

## API

Todas as respostas seguem o mesmo formato:

```json
{ "success": true, "data": { }, "message": "..." }
{ "success": false, "message": "Mensagem para o usuário", "error": "CODIGO", "details": { "campo": "erro" } }
```

Listagens incluem `pagination` com `page`, `pageSize`, `total` e `totalPages`.

### Autenticação

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/auth/login` | Devolve o token JWT |
| `POST` | `/api/auth/logout` | Registra a saída na auditoria |
| `GET` | `/api/auth/me` | Dados do usuário autenticado |
| `POST` | `/api/auth/change-password` | Troca a própria senha |

### Dashboard e busca

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/dashboard?period=` | Métricas, últimas coletas e série mensal |
| `GET` | `/api/search?q=` | Busca global de proprietários e máquinas |

`period` aceita `today`, `week`, `month`, `last_month`, `all` e `custom`
(com `start_date` e `end_date`).

### Proprietários

| Método | Rota |
|---|---|
| `GET` | `/api/owners?page=&pageSize=&search=&status=` |
| `POST` | `/api/owners` |
| `GET` | `/api/owners/:id` |
| `PUT` | `/api/owners/:id` |
| `PATCH` | `/api/owners/:id/status` |
| `GET` | `/api/owners/:id/machines` |
| `GET` | `/api/owners/:id/collections` |

### Máquinas

| Método | Rota |
|---|---|
| `GET` | `/api/machines?page=&search=&status=&owner_id=` |
| `POST` | `/api/machines` |
| `GET` | `/api/machines/:id` |
| `PUT` | `/api/machines/:id` |
| `PATCH` | `/api/machines/:id/status` |
| `GET` | `/api/machines/:id/collections` |
| `GET` | `/api/machines/:id/last-reading` |

### Coletas

| Método | Rota | Observação |
|---|---|---|
| `GET` | `/api/collections` | Filtros por proprietário, máquina, status e período |
| `POST` | `/api/collections` | `multipart/form-data`, **exige ao menos uma imagem** |
| `GET` | `/api/collections/:id` | Detalhe com imagens |
| `POST` | `/api/collections/:id/cancel` | Exige `reason` |
| `GET` | `/api/collections/images/:imageId` | Imagem protegida por token |

### Relatórios

| Método | Rota |
|---|---|
| `GET` | `/api/reports/owners` |
| `GET` | `/api/reports/machines` |
| `GET` | `/api/reports/period` |
| `GET` | `/api/reports/pdf?type=period\|owners\|machines` |

### Auditoria

| Método | Rota | Acesso |
|---|---|---|
| `GET` | `/api/audit-logs` | Somente `admin` |

---

## Testes

```bash
npm test              # 89 testes
npm run test:unit     # cálculo e validações (não precisa de banco)
npm run test:api      # API completa contra MySQL real
npm run test:browser  # interface e responsividade em Chromium
```

Detalhes em [`tests/README.md`](tests/README.md).

**Cobertura:** autenticação (token inválido, expirado, forjado), CRUD e
validações, primeira coleta, encadeamento do histórico, tentativa de forjar
valores pelo frontend, leitura menor que a anterior, exceção justificada, foto
obrigatória, arquivo que só finge ser imagem, cancelamento e seus bloqueios,
totais que ignoram canceladas, relatórios, geração de PDF, auditoria, SQL
injection, XSS armazenado e consistência aritmética de todas as coletas gravadas.

Os testes de navegador verificam ainda **11 telas em 7 larguras** (320px a
1920px) confirmando a ausência de rolagem horizontal.

---

## Segurança

| Item | Implementação |
|---|---|
| Senhas | Bcrypt; nunca trafegam nem são armazenadas em texto puro |
| Sessão | JWT com expiração; o usuário é revalidado no banco a cada requisição |
| SQL Injection | Queries parametrizadas em 100% dos acessos (`mysql2` prepared statements) |
| XSS | Todo texto vindo do banco passa por `escapeHtml` antes de ir ao DOM |
| CSP | Content-Security-Policy sem nenhum host externo permitido |
| Cabeçalhos | Helmet: `nosniff`, `frame-ancestors`, `X-Powered-By` removido |
| CORS | Mesma origem sempre liberada; origens externas só via `CORS_ORIGINS` |
| Força bruta | Limite de 10 tentativas de login por 15 minutos, por IP |
| Enumeração de usuários | Mensagem idêntica para e-mail inexistente e senha errada |
| Timing attack | Comparação de hash executada mesmo quando o usuário não existe |
| Upload | Extensão, MIME e **assinatura binária real** do arquivo; limite de tamanho e quantidade |
| Path traversal | Caminho da imagem resolvido e conferido contra a raiz de uploads |
| Acesso a imagens | Servidas apenas com token válido, nunca por URL pública |
| Erros | Resposta padronizada; stack trace jamais chega ao cliente |

---

## Decisões técnicas

Decisões tomadas onde a especificação deixou espaço:

**Aritmética em centavos.** Todo cálculo financeiro acontece com inteiros
(centavos) e só é convertido para `DECIMAL(14,2)` na gravação. Elimina qualquer
erro de ponto flutuante — testado com 1.000 somas encadeadas.

**`bcryptjs` no lugar de `bcrypt`.** Implementa o mesmo algoritmo e gera hashes
compatíveis, mas é JavaScript puro: dispensa compilador C++ e `node-gyp`, o que
evita problemas de instalação no Windows. Para trocar, basta instalar `bcrypt` e
alterar o `require` em dois arquivos.

**Bootstrap local em vez de CDN.** O sistema pode rodar em rede interna sem
internet. O `postinstall` copia os arquivos de `node_modules`.

**Imagens em disco, metadados no banco.** O banco guarda caminho, nome original,
MIME, tamanho e o SHA-256 de cada arquivo, o que permite auditar a integridade
sem inchar o banco com BLOBs.

**Bloqueio pessimista na coleta.** A criação da coleta acontece em uma transação
que trava a máquina (`SELECT ... FOR UPDATE`), impedindo que duas coletas
simultâneas leiam a mesma "leitura anterior".

**Cancelamento em ordem inversa.** Só é possível cancelar a coleta mais recente
da máquina. Cancelar uma coleta do meio quebraria o encadeamento
anterior → atual das seguintes. A mensagem explica isso ao usuário.

**Troca de proprietário bloqueada com histórico.** Uma máquina que já tem
coletas não pode simplesmente mudar de dono — isso é uma *transferência*, e a
tabela `machine_transfers` já está preparada para o recurso.

**Sem rolagem horizontal, sem esconder conteúdo.** Em telas menores que 768px as
tabelas viram cartões empilhados com rótulo por campo (`data-label`), em vez de
ocultar colunas. Tabelas muito largas rolam **dentro do próprio cartão** no
desktop; a página em si nunca rola para os lados.

**Gráfico em SVG puro.** A evolução financeira é desenhada com SVG e `viewBox`,
sem biblioteca de gráficos — leve, responsivo por natureza e sem dependência
externa.

---

## Evolução futura

A arquitetura já está preparada para:

- **Múltiplos usuários e permissões** — `users.role` já tem `admin`, `operator` e `viewer`, e o middleware `authorize()` está em uso
- **Transferência de máquinas** — tabela `machine_transfers` criada
- **Divisão financeira** — tabela `machine_revenue_splits` criada
- **QR Code** — a tela de nova coleta já aceita `?machine_id=`, bastando apontar o QR para essa URL

Nada disso está ativo no MVP.

---

## Solução de problemas

**Qualquer erro de conexão com o banco** — rode `npm run db:check`. Ele testa a
conexão e aponta a causa exata.

**`Access denied for user 'root'@'localhost' (using password: YES)`** — a senha
do `.env` não confere com a do MySQL. O `npm run db:check` confirma isso e
sugere o que fazer. Para testar a senha por fora: `mysql -u root -p`.

**`JWT_SECRET deve ter no minimo 32 caracteres em producao`** — gere um segredo
maior com o comando da seção de configuração.

**Porta 3000 em uso** — altere `PORT` no `.env`.

**Estilos não carregam** — rode `npm run vendor` para recopiar o Bootstrap.

**Não consigo acessar do celular** — libere a porta 3000 no firewall do Windows
e use o IP da máquina na rede, não `localhost`.
