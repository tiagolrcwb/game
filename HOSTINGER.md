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
DB_PORT=3306
DB_USER=usuario_do_mysql
DB_PASSWORD=senha_do_mysql
DB_NAME=nome_do_banco
JWT_SECRET=uma_chave_longa_e_aleatoria
MANAGER_TOKEN=uma_chave_longa_para_a_tela_de_gerente
```

Nao suba `.env` para o Git.

Na Hostinger, deixe `PORT` vazio a menos que o painel informe explicitamente uma porta para o app Node.js. `PORT` e a porta HTTP do Node; a porta do MySQL e `DB_PORT`.

## Banco de dados

O caminho recomendado e aplicar as migrations pela tela de gerente:

```text
https://game.solodev.com.br/manager.html
```

Entre com `MANAGER_TOKEN`, abra a secao `Migrations` e clique em `Aplicar pendentes`.

O arquivo abaixo continua sendo a referencia completa do schema atual:

```text
database/schema.sql
```

Esse arquivo cria a tabela `users`, usada pelo cadastro e login.
Ele tambem cria as tabelas da area de gerente:

```text
game_settings
maps
races
character_classes
```

Se o banco ja existir na Hostinger, execute o conteudo do `schema.sql` dentro do banco ja criado no phpMyAdmin.

Cada alteracao futura de banco deve gerar um novo arquivo em:

```text
database/migrations/
```

A tela de gerente le esses arquivos, registra aplicacoes em `schema_migrations` e evita reaplicar o que ja foi executado.

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
/api/health    teste simples de conexao com o banco
/api/manager/state     leitura dos cadastros do gerente
/api/manager/settings  configuracao do nome do jogo e mapa inicial
/api/manager/maps      mapas, tamanho das celulas e saidas
/api/manager/races     racas
/api/manager/classes   classes
/manager.html  tela de gerente protegida por MANAGER_TOKEN
WebSocket      mesmo host do site, usando ws:// ou wss://
```

## Observacao sobre WebSocket

O cliente usa automaticamente `wss://` quando o site esta em HTTPS. Se o login funcionar mas o jogo nao conectar, verifique no painel/logs da Hostinger se o ambiente Node.js esta aceitando conexoes WebSocket.
