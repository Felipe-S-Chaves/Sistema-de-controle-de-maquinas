# Testes

Os testes usam um banco **separado** (`music_machines_test`), recriado do zero a
cada execução. Os dados de produção nunca são tocados.

## Preparação

Nenhuma. O banco `music_machines_test` é criado automaticamente na primeira
execução, desde que o usuário do `.env` possa criar bancos.

Se preferir usar um usuário restrito, crie o banco antes:

```sql
CREATE DATABASE music_machines_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON music_machines_test.* TO 'seu_usuario'@'localhost';
```

## Executar

```bash
npm test              # tudo
npm run test:unit     # cálculo financeiro e validações (sem banco)
npm run test:api      # API completa contra MySQL real
npm run test:browser   # interface e responsividade em Chromium
```

## O que cada suíte cobre

| Arquivo | Cobertura |
|---|---|
| `calculator.test.js` | Regra financeira central, aritmética em centavos, formatação monetária |
| `validation.test.js` | CPF/CNPJ, campos obrigatórios, enums, períodos |
| `api.test.js` | Autenticação, proprietários, máquinas, coletas, cancelamento, relatórios, PDF, auditoria, segurança e consistência dos dados |
| `browser.test.js` | Fluxo de coleta no celular, cálculo em tempo real, exceção de leitura, cancelamento, busca global, responsividade em 7 larguras |

## Testes de navegador

Precisam de Chromium/Chrome e do pacote `puppeteer-core`. Se nenhum dos dois
estiver disponível, essas suítes são **ignoradas automaticamente** — o restante
continua rodando.

Para apontar um navegador específico:

```bash
CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npm run test:browser
```
