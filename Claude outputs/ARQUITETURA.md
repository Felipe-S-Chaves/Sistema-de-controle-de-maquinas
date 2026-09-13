# Arquitetura e plano de implementação

Documento de referência do sistema, cobrindo os 16 pontos exigidos na seção 6 da
especificação. O que está aqui foi **implementado e testado**, não é proposta.

---

## 1. Arquitetura

Aplicação monolítica em três camadas, servida por um único processo Node.js.

```
Navegador (HTML + Bootstrap + JS)
        │  fetch / JSON  ·  multipart para imagens
        ▼
Express  ─ middlewares: helmet · cors · rate limit · JWT · multer
        │
   Routes → Controllers → Services → Repositories
        │                    │            │
        │              regras de       queries
        │              negócio e      parametrizadas
        │              cálculo            │
        ▼                                 ▼
   frontend/ estático                   MySQL
                                    backend/uploads/
```

O mesmo processo serve a API (`/api/*`) e os arquivos do frontend. Isso mantém a
implantação simples — um comando, um serviço — e faz do caso normal uma
requisição *same-origin*.

**Por que monolito:** o sistema atende centenas de proprietários, máquinas e
coletas, com um administrador e alguns operadores. Separar em serviços
adicionaria operação e latência sem resolver nenhum problema real.

---

## 2. Stack

| Camada | Tecnologia | Papel |
|---|---|---|
| Frontend | HTML5, CSS3, JavaScript ES5+, Bootstrap 5.3 | Interface responsiva, sem framework SPA |
| Backend | Node.js 18+, Express 4 | API REST |
| Banco | MySQL 8 / MariaDB 10.4+ via `mysql2` | Persistência relacional |
| Auth | `jsonwebtoken`, `bcryptjs` | Token e hash de senha |
| Upload | `multer` | Recebimento de imagens |
| PDF | `pdfkit` | Relatórios em PDF |
| Segurança | `helmet`, `cors`, `express-rate-limit` | Cabeçalhos, origem e força bruta |
| Testes | `node:test`, `puppeteer-core` | Unitários, API e navegador |

O Bootstrap é servido **localmente**, copiado de `node_modules` no
`postinstall`. Nenhum recurso externo é carregado em tempo de execução.

---

## 3. Modelo do banco

Oito tabelas InnoDB, `utf8mb4_unicode_ci`, valores monetários em `DECIMAL(14,2)`.

### `users`
`id · name · email(unique) · password_hash · role(admin|operator|viewer) · status · last_login_at · created_at · updated_at`

### `owners`
`id · name · document(unique) · document_type(cpf|cnpj) · phone · whatsapp · email · address · city · state · zip_code · notes · status(active|inactive) · created_by · created_at · updated_at`

Não existe entidade "estabelecimento". O proprietário é o topo da hierarquia.

### `machines`
`id · number(unique) · name · owner_id · model · manufacturer · serial_number · installation_date · status(active|maintenance) · notes · created_by · created_at · updated_at`

Apenas dois status, como exigido.

### `collections`
```
id · machine_id · owner_id · user_id

previous_entry_value · current_entry_value · calculated_entry_value
previous_exit_value  · current_exit_value  · calculated_exit_value
calculated_total_value

is_first_collection · is_exception · exception_reason
observation · status(confirmed|cancelled)
collected_at · timezone · created_at · updated_at
cancelled_at · cancelled_by · cancellation_reason
```

`owner_id` é um *snapshot* do dono no momento da coleta: se a máquina for
transferida no futuro, o histórico financeiro continua atribuído corretamente.

### `collection_images`
`id · collection_id · user_id · file_path · original_name · mime_type · size_bytes · checksum(sha256) · created_at`

Arquivo em disco, metadados no banco.

### `audit_logs`
`id · user_id · entity · entity_id · action · old_values(JSON) · new_values(JSON) · reason · ip_address · user_agent · created_at`

### `machine_transfers` e `machine_revenue_splits`
Criadas e relacionadas, **sem uso no MVP**. Existem para que os recursos futuros
não exijam migração destrutiva.

---

## 4. Relacionamentos

```
users   1 ─── N  collections        (usuário responsável)
owners  1 ─── N  machines           (máquina pertence direto ao proprietário)
owners  1 ─── N  collections        (snapshot do dono na coleta)
machines 1 ─── N  collections
collections 1 ─── N  collection_images
```

**Integridade:**

- Vínculos financeiros usam `ON DELETE RESTRICT` — proprietário ou máquina com
  histórico não podem ser removidos
- `collection_images` usa `ON DELETE CASCADE` — as imagens pertencem à coleta
- Referências a `users` usam `ON DELETE SET NULL` — remover um usuário não apaga
  histórico financeiro
- `CHECK` impede leituras negativas

**Índices:** `(machine_id, collected_at)`, `(owner_id, collected_at)`,
`(status, collected_at)` e `(machine_id, status, id)` — cobrem o histórico da
máquina, os relatórios por período e a busca da última leitura confirmada.

---

## 5. Autenticação

- Login por e-mail e senha; senha verificada com Bcrypt
- Resposta idêntica para e-mail inexistente e senha errada, e comparação de hash
  executada mesmo sem usuário (evita enumeração e *timing attack*)
- JWT assinado com `JWT_SECRET`, expiração configurável (padrão 8h)
- Token no header `Authorization: Bearer`
- A cada requisição o middleware **revalida o usuário no banco** — desativar um
  usuário derruba o acesso na hora, sem esperar o token expirar
- `authorize(...roles)` restringe rotas por papel; a auditoria é só de `admin`
- Limite de 10 tentativas de login por 15 minutos por IP
- O frontend guarda o token em `sessionStorage`, ou em `localStorage` quando o
  usuário marca "manter conectado"
- Resposta 401 limpa a sessão e devolve o usuário ao login com aviso

---

## 6. Estrutura de pastas

```
backend/
  config/        env.js · database.js
  controllers/   auth · owner · machine · collection · dashboard · report · audit
  services/      authService · ownerService · machineService · collectionService
                 collectionCalculator · dashboardService · reportService
                 pdfService · auditService
  repositories/  user · owner · machine · collection
  middlewares/   auth.js · upload.js · errorHandler.js
  routes/        index.js · authRoutes.js
  validations/   validator.js
  utils/         money · datetime · AppError · response · asyncHandler
  database/      schema.sql · migrate.js · seed.js
  uploads/       AAAA/MM/arquivo.png
  app.js · server.js

frontend/
  assets/css/app.css
  assets/js/     api · utils · layout + um arquivo por tela
  assets/vendor/bootstrap/
  *.html         uma página por tela

tests/           calculator · validation · api · browser · helpers
scripts/         copy-vendor.js
docs/            este documento
```

Nenhum arquivo concentra o sistema inteiro: o maior módulo do backend é o
`collectionService`, com pouco mais de 300 linhas, e cada tela do frontend tem
seu próprio arquivo.

---

## 7. Rotas da API

```
POST   /api/auth/login              POST   /api/auth/logout
GET    /api/auth/me                 POST   /api/auth/change-password

GET    /api/dashboard               GET    /api/search

GET    /api/owners                  POST   /api/owners
GET    /api/owners/:id              PUT    /api/owners/:id
PATCH  /api/owners/:id/status
GET    /api/owners/:id/machines     GET    /api/owners/:id/collections

GET    /api/machines                POST   /api/machines
GET    /api/machines/:id            PUT    /api/machines/:id
PATCH  /api/machines/:id/status
GET    /api/machines/:id/collections
GET    /api/machines/:id/last-reading

GET    /api/collections             POST   /api/collections
GET    /api/collections/:id         POST   /api/collections/:id/cancel
GET    /api/collections/images/:imageId

GET    /api/reports/owners          GET    /api/reports/machines
GET    /api/reports/period          GET    /api/reports/pdf

GET    /api/audit-logs              (somente admin)
GET    /api/health
```

Formato de resposta uniforme, com `success`, `message`, `data`, `error` e
`details` por campo. Listagens trazem `pagination`.

---

## 8. Componentes do frontend

**Camadas compartilhadas**

| Arquivo | Responsabilidade |
|---|---|
| `api.js` | Toda comunicação HTTP: token, erros, upload, download de PDF, imagens protegidas |
| `utils.js` | Formatação (dinheiro, data, documento, telefone), toasts, estados de carregamento/vazio/erro, paginação, modal de confirmação, escape de HTML |
| `layout.js` | Cabeçalho, menu lateral responsivo, busca global, guarda de autenticação, modal de troca de senha |

**Telas**

`auth` · `dashboard` · `owners` · `owner-detail` · `machines` · `machine-detail`
· `collections` · `collection-new` · `collection-detail` · `reports` · `audit`

**Componentes visuais próprios**

- `metric-card` — cartão de métrica do dashboard
- `table-responsive-cards` — tabela que vira cartões abaixo de 768px
- `reading-box` — bloco de leitura de relógio
- `result-box` — destaque do valor apurado
- `photo-grid` / `photo-thumb` — pré-visualização e remoção de fotos
- `step-card` — passo do fluxo de coleta, habilitado progressivamente

---

## 9. Regras de negócio

1. Um proprietário tem várias máquinas; a máquina pertence **direto** a ele
2. Não existe entidade "estabelecimento"
3. Número da máquina é único; a interface sempre exibe `NÚMERO — NOME`
4. Status da máquina: apenas `Ativa` e `Manutenção`
5. Cada máquina tem relógio de entrada e de saída, acumulados
6. Cada coleta grava os dois relógios e cria um **registro novo**
7. `Entrada apurada = entrada atual − entrada anterior`
8. `Saída apurada = saída atual − saída anterior`
9. `Valor apurado = entrada apurada − saída apurada`
10. O usuário nunca digita valores apurados
11. O backend **sempre recalcula** antes de gravar
12. A leitura anterior vem do banco; na primeira coleta o operador a informa
13. Leitura menor que a anterior bloqueia e exige exceção justificada
14. Toda coleta exige ao menos uma foto
15. Data, hora, fuso e usuário são registrados automaticamente
16. Cancelamento exige motivo, preserva o registro e o tira dos totais
17. Só a coleta mais recente da máquina pode ser cancelada
18. Coletas canceladas não servem de base para a leitura seguinte
19. Máquina com histórico não troca de proprietário (isso é transferência)
20. Totais somam coleta a coleta, nunca "último relógio menos primeiro"

---

## 10. Validações

**No backend** (autoridade final), via `validations/validator.js`:

- Obrigatoriedade, comprimento mínimo e máximo
- CPF e CNPJ com dígitos verificadores
- E-mail normalizado para minúsculas
- Telefone e CEP normalizados para dígitos
- UF conferida contra a lista de estados
- Enums restritos aos valores permitidos
- Valores monetários aceitos em `1.234,56`, `1234.56` ou `1234,56`, convertidos
  para centavos e limitados a `DECIMAL(14,2)`
- Unicidade de CPF/CNPJ e de número de máquina
- Existência das chaves estrangeiras antes do insert

**No frontend** (feedback imediato): campos obrigatórios, máscaras de
CPF/CNPJ/telefone/CEP, formato monetário, cálculo em tempo real, botão de salvar
bloqueado enquanto faltar foto ou exceção justificada.

Erros voltam como `422` com `details` por campo, e a interface marca cada campo
e rola até o primeiro problema.

---

## 11. Estratégia de imagens

- Gravadas em `backend/uploads/AAAA/MM/` com nome aleatório
- Banco guarda caminho relativo, nome original, MIME, tamanho e **SHA-256**
- Validação em três níveis: extensão, MIME declarado e **assinatura binária real**
  (um `.png` com conteúdo falso é rejeitado)
- Limites configuráveis: 8 MB por arquivo, 8 arquivos por coleta
- Servidas apenas por rota autenticada; o token vai no header, nunca na URL
- Caminho resolvido e conferido contra a raiz de uploads (anti *path traversal*)
- Se a transação da coleta falhar, os arquivos já gravados são removidos
- Pré-visualização e remoção antes de salvar, direto no navegador

---

## 12. Estratégia de PDF

`pdfkit` gera o documento em memória e envia como buffer, sem arquivo temporário.

Estrutura: cabeçalho com título e filtros aplicados · tabela zebrada com
cabeçalho repetido a cada página · bloco de totais · rodapé numerado com o aviso
de que só coletas confirmadas entram nos totais.

O relatório analítico por período sai em paisagem (mais colunas); os
consolidados, em retrato. As colunas são escaladas proporcionalmente à largura
útil da página, então nada é cortado.

---

## 13. Auditoria

`auditService.log()` registra criação, edição, mudança de status, exceção de
leitura, cancelamento, login, tentativa de login e logout — com usuário,
data/hora, IP, *user agent*, valores antes e depois (JSON) e motivo.

Quando a operação acontece dentro de uma transação, o log é gravado **na mesma
transação**: ou tudo é registrado, ou nada acontece. Uma falha ao gravar o log
nunca derruba a operação já validada — ela é registrada no console do servidor.

Nada financeiro é apagado: cancelamento é mudança de status, não `DELETE`.

---

## 14. Segurança

Bcrypt · JWT com revalidação no banco · CORS que libera a mesma origem e exige
allowlist para as demais · Helmet com CSP sem host externo · rate limit no login
· queries 100% parametrizadas · escape de HTML na exibição · validação de upload
em três níveis · proteção contra path traversal · imagens só com token · erros
padronizados sem stack trace.

A tabela completa está no [README](../README.md#segurança).

---

## 15. Testes

89 testes automatizados, em quatro suítes:

| Suíte | Testes | Cobertura |
|---|---|---|
| `calculator.test.js` | 10 | Regra financeira, centavos, formatação |
| `validation.test.js` | 8 | CPF/CNPJ, obrigatoriedade, enums, períodos |
| `api.test.js` | 62 | API completa contra MySQL real |
| `browser.test.js` | 9 | Fluxo no celular e responsividade em 7 larguras |

Destaques: tentativa de forjar `previous` e `calculated_total` pelo formulário,
arquivo que só finge ser imagem, cancelamento fora de ordem, totais que ignoram
canceladas, SQL injection com `UNION` e `DROP`, e uma verificação que recalcula
**todas** as coletas gravadas conferindo a fórmula.

---

## 16. Plano de implementação

Executado em oito etapas, cada uma implementada, testada e validada antes da
seguinte:

| # | Etapa | Validação |
|---|---|---|
| 1 | Banco e fundação do backend | Migrations e seed rodando em MySQL real |
| 2 | Autenticação e auditoria | Login correto, incorreto, token inválido e expirado |
| 3 | Proprietários e máquinas | CRUD, busca parcial, unicidade, status |
| 4 | Coletas, cálculo e imagens | Encadeamento, exceção, foto obrigatória, cancelamento |
| 5 | Dashboard, relatórios e PDF | Totais conferidos e PDF renderizado e inspecionado |
| 6 | Frontend responsivo | 11 telas construídas |
| 7 | Testes automatizados | 89 testes |
| 8 | Responsividade e entrega | 11 telas × 7 larguras sem rolagem horizontal |

Dois problemas reais foram encontrados e corrigidos durante a validação: o CORS
rejeitava requisições da própria origem quando o host/porta diferia do `.env`
(quebraria o acesso por IP de rede local), e os botões do cabeçalho ficavam
abaixo da área de toque recomendada no celular.

---

## Observação sobre a especificação

O exemplo de histórico da seção 24 traz, na linha de 14/08:

```
Entrada anterior: R$ 6.000    Entrada atual: R$ 7.200   → apurada 1.200
Saída anterior:   R$ 4.200    Saída atual:   R$ 5.100   → apurada   900
Apurado: R$ 500
```

Pela fórmula obrigatória, `1.200 − 900 = 300`, não `500`. As outras duas linhas
do exemplo (07/08 e 21/08) fecham corretamente. O sistema segue a **fórmula**,
que é a regra inegociável, e não o número dessa linha.
