# Fase 13 — configurações de dados locais

## Escopo

A Fase 13 adiciona `/settings` para inspecionar e limpar os dados de domínio mantidos pelo EasyPoll no SQLite local. A página funciona sem uma sessão WhatsApp disponível e não chama `WhatsAppService`, `HistoryService`, Puppeteer ou rotinas de sincronização.

Backup, restauração, exportação, importação, preferências visuais e configurações do WhatsApp foram deliberadamente adiados.

## Arquitetura

O backend mantém a separação:

```text
settings.routes.ts
        ↓
settings.service.ts
        ↓
settings.repository.ts
        ↓
SQLite local
```

- A route valida as confirmações e traduz os resultados para HTTP.
- O service compõe as métricas com os metadados seguros do arquivo SQLite.
- O repository contém as consultas agregadas e as transações destrutivas.
- Nenhuma query SQL fica na route.

No frontend, `useSettingsStorage` centraliza GET, refresh e DELETEs por meio da API existente. `SettingsPage` compõe o resumo, a lista de grupos, o aviso de privacidade, os diálogos e a zona de perigo.

## API

### `GET /api/settings/storage`

Retorna um DTO no formato:

```json
{
  "database": {
    "fileName": "easypoll.db",
    "relativePath": "data/easypoll.db",
    "sizeBytes": 15518924
  },
  "totals": {
    "groups": 7,
    "polls": 421,
    "participations": 3842,
    "selections": 8941,
    "processedMessages": 40183
  },
  "groups": []
}
```

Cada item de `groups` inclui `id`, `name`, as quatro contagens relacionadas, `lastSyncAt`, `oldestProcessedTimestamp` e `newestProcessedTimestamp`.

O resumo usa duas consultas agregadas fixas: uma para os totais e outra para todos os grupos. Não existe uma consulta por métrica e por grupo.

### Semântica das métricas

- `groups`: linhas em `groups`.
- `polls`: linhas em `polls`.
- `selections`: linhas em `poll_votes`.
- `processedMessages`: linhas em `processed_messages`.
- `participations`: pares distintos `poll_id + voter_id`.

Assim, uma pessoa que seleciona duas opções na mesma enquete produz uma participação e duas seleções. As contagens por grupo são derivadas somente das polls daquele grupo.

### Tamanho do banco

O service usa `fs.statSync`, sem dependência adicional, e soma quando presentes:

- `easypoll.db`;
- `easypoll.db-wal`;
- `easypoll.db-shm`.

O frontend recebe apenas `easypoll.db` e `data/easypoll.db`; o caminho absoluto do computador nunca integra o DTO. A limpeza não executa `VACUUM`, portanto o arquivo pode manter páginas livres para reutilização e seu tamanho físico pode não diminuir imediatamente.

## Limpeza de um grupo

### `DELETE /api/settings/groups/:groupId/data`

O body deve conter exatamente:

```json
{ "confirmGroupId": "<mesmo groupId da URL>" }
```

Confirmação ausente ou divergente retorna `400` sem remover rows. Grupo local inexistente retorna `404`.

A operação ocorre em uma transação:

1. lê o resumo do grupo;
2. remove a row de `groups`;
3. deixa as foreign keys existentes removerem `polls`, `poll_options`, `poll_votes`, `processed_messages` e `sync_state` por cascade;
4. remove membros que não sejam mais referenciados por `polls.creator_id` nem `poll_votes.voter_id`;
5. confirma a transação.

Uma falha em qualquer etapa executa rollback. Membros ainda usados em qualquer outro grupo permanecem. A resposta contém apenas o ID e as contagens removidas, nunca conteúdo de enquetes.

## Limpeza completa

### `DELETE /api/settings/data`

O body deve conter exatamente:

```json
{ "confirm": "DELETE_ALL_LOCAL_DATA" }
```

Na UI, o botão só é habilitado quando a pessoa digita `LIMPAR TUDO`. A confirmação do backend é independente e obrigatória.

Em uma única transação, o repository remove todas as rows de `groups`, deixa os cascades limparem os dados dependentes e então remove todos os `members`. O resultado esperado é zero rows em:

- `groups`;
- `members`;
- `polls`;
- `poll_options`;
- `poll_votes`;
- `processed_messages`;
- `sync_state`.

O arquivo `easypoll.db` não é apagado. O schema, `__drizzle_migrations` e as migrations versionadas permanecem, e o banco continua aceitando novos dados.

## Privacidade e limites destrutivos

“Limpar dados locais” remove somente rows armazenadas pelo EasyPoll. Nenhum endpoint de Settings conhece ou recebe o caminho de `.wwebjs_auth` e nenhuma operação toca em:

- mensagens ou enquetes do WhatsApp;
- grupos ou membros do WhatsApp;
- `LocalAuth` e a sessão WhatsApp;
- `easyPoll.favoriteGroups`;
- `easyPoll.lastGroupId`;
- migrations ou o arquivo SQLite.

Mensagens comuns continuam fora do banco. A interface repete esse limite nos dois diálogos destrutivos.

## Estados da página

- Loading: skeletons preservam a estrutura do resumo e da lista.
- Erro: mensagem curta e ação “Tentar novamente”, sem stack trace.
- Vazio: explica que o banco será preenchido ao analisar ou sincronizar um grupo.
- Sucesso destrutivo: fecha o diálogo, apresenta toast e atualiza o resumo sem recarregar a página inteira.

Os diálogos apenas abrem e fecham localmente; nenhuma requisição destrutiva ocorre antes do botão final de confirmação.

## Testes

Os testes usam bancos SQLite temporários ou em memória. Eles cobrem:

- totais com dois grupos e cinco polls;
- participação versus seleção em múltipla escolha;
- isolamento das métricas por grupo;
- soma de `.db`, `-wal` e `-shm` sem exposição do caminho absoluto;
- cascade ao limpar um grupo;
- preservação de membro compartilhado e remoção de membro órfão;
- rollback forçado de limpeza de grupo e limpeza completa;
- confirmação obrigatória dos dois endpoints;
- preservação do arquivo, schema e metadata de migrations;
- persistência de uma nova poll depois da limpeza completa;
- execução sem carregar WhatsApp, `WhatsAppService` ou `HistoryService`;
- smoke de `/settings`, navegação ativa e proteções dos diálogos;
- ausência de overflow e encaixe do diálogo em 1440×900, 768×1024 e 390×844.

O smoke não confirma nenhuma ação destrutiva.
