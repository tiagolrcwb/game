# Deploy na Hostinger

Este projeto roda como uma aplicacao Node.js com paginas estaticas, API HTTP, WebSocket e MySQL.

## Configuracao do app

No hPanel, em `game.solodev.com.br`, selecione o repositorio Git deste projeto e configure como Node.js App.

Use estes valores:

```text
Framework: Other
Node.js version: 20 ou 22
Install command: npm install
Build command: vazio
Start command: npm start
Entry file: app.js
```

Se a Hostinger pedir o arquivo principal diretamente, use `app.js`. O `app.js` carrega `server/index.js`.

## Variaveis de ambiente

Cadastre no painel da Hostinger:

```text
DB_HOST=host_do_mysql
DB_USER=usuario_do_mysql
DB_PASSWORD=senha_do_mysql
DB_NAME=nome_do_banco
JWT_SECRET=uma_chave_longa_e_aleatoria
```

Nao suba `.env` para o Git.

## Banco de dados

Antes de abrir o jogo em producao, importe:

```text
database/schema.sql
```

Esse arquivo cria a tabela `users`, usada pelo cadastro e login.

Se o banco ja existir na Hostinger, voce pode executar apenas a parte do `CREATE TABLE` no phpMyAdmin.

## Comandos locais

```powershell
npm install
npm run check
npm start
```

## Rotas principais

```text
/              tela de login
/game.html     tela do jogo
/api/register  cadastro
/api/login     login
WebSocket      mesmo host do site, usando ws:// ou wss://
```

## Observacao sobre WebSocket

O cliente usa automaticamente `wss://` quando o site esta em HTTPS. Se o login funcionar mas o jogo nao conectar, verifique no painel/logs da Hostinger se o ambiente Node.js esta aceitando conexoes WebSocket.
