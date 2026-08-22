# Fase 9 — Histórico persistente de enquetes

## Objetivo

A rota `/history` permite consultar enquetes já persistidas no SQLite. A abertura da página, a listagem e o detalhe não consultam WhatsApp, Puppeteer, mensagens comuns ou o `HistoryService` de sincronização.

O fluxo de leitura é:

```text
SQLite → HistoryRepository → HistoryQueryService → REST API → history.js
```

Somente os botões explícitos **Sincronizar novidades** e **Buscar histórico mais antigo** chamam os endpoints incrementais existentes da Fase 7.

## Componentes

- `HistoryRepository`: executa consultas Drizzle parametrizadas nas tabelas de domínio `groups`, `polls`, `poll_options`, `poll_votes` e `members`.
- `HistoryQueryService`: valida paginação, busca e datas, converte dias de São Paulo em timestamps e monta os DTOs públicos.
- `history.routes.ts`: expõe as APIs locais e converte erros de entrada em HTTP 400 e recursos ausentes em HTTP 404.
- `history.html`, `history.css` e `history.js`: página vanilla dedicada, com seletor de grupos locais, filtros, paginação, modal de detalhe e controles de sincronização.

Nenhuma migration foi adicionada. O índice existente `polls(group_id, created_at)` atende o acesso por grupo e data; não foi criado índice textual ou FTS especulativo.

## APIs

### `GET /api/groups/:groupId/history`

Parâmetros opcionais:

- `page`: inteiro positivo; padrão `1`;
- `pageSize`: inteiro positivo; padrão `25`, máximo `100`;
- `search`: trecho literal da pergunta, até 255 caracteres;
- `from`: primeiro dia incluído, em `YYYY-MM-DD`;
- `to`: último dia incluído, em `YYYY-MM-DD`.

A resposta contém:

```json
{
  "items": [
    {
      "messageId": "...",
      "question": "...",
      "createdAt": 1787366520,
      "creator": { "id": "...", "displayName": "..." },
      "allowMultipleAnswers": true,
      "optionCount": 3,
      "votesSnapshotAvailable": true,
      "participantCount": 18,
      "selectionCount": 24
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "totalItems": 327,
    "totalPages": 14
  }
}
```

A ordenação é `created_at DESC, message_id DESC`. A segunda chave torna a paginação determinística quando timestamps empatam.

A listagem usa duas queries fixas:

1. existência do grupo e contagem filtrada;
2. página de polls com criador e agregados.

Ela não carrega os participantes. `COUNT(DISTINCT voter_id)` calcula participantes, enquanto `COUNT(DISTINCT poll_votes.id)` calcula seleções. Os joins agregados evitam N+1.

A busca usa `LIKE` parametrizado, comparação sem diferença entre maiúsculas e minúsculas dentro das capacidades padrão do SQLite e escape literal de `\`, `%` e `_`. Não há concatenação de input em SQL.

### `GET /api/groups/:groupId/history/:messageId`

Retorna uma única enquete pertencente ao grupo informado:

```json
{
  "messageId": "...",
  "groupId": "...",
  "question": "...",
  "createdAt": 1787366520,
  "allowMultipleAnswers": true,
  "creator": { "id": "...", "displayName": "..." },
  "votesSnapshotAvailable": true,
  "votesSnapshotAt": 1787366600,
  "participantCount": 1,
  "selectionCount": 2,
  "options": [
    { "id": 10, "text": "Pizza", "position": 0, "selectionCount": 1 }
  ],
  "participants": [
    {
      "id": "...",
      "displayName": "João",
      "votedAt": 1787366590,
      "selectedOptions": [
        { "id": 10, "text": "Pizza", "position": 0 }
      ]
    }
  ]
}
```

O detalhe usa três queries fixas:

1. poll e criador, com `group_id` e `message_id` no filtro;
2. opções ordenadas por `position` e suas contagens;
3. seleções associadas a participantes e opções.

Opções de texto duplicado permanecem distintas porque votos são associados pela FK `poll_votes.option_id`, nunca pelo texto.

## Semântica dos dados de votação

`participantCount` é o número de participantes distintos dentro de cada poll. Uma pessoa que seleciona A e B conta como uma participação.

`selectionCount` é o número de opções selecionadas. Na mesma situação, A e B contam como duas seleções. Em uma poll de múltiplas respostas, esse valor pode ser maior que `participantCount`.

Quando `votes_snapshot_available = false`:

- `participantCount` e `selectionCount` são `null`;
- contagens de opções são `null`;
- `participants` é `null`;
- a UI explica que os dados ainda não foram recuperados.

Quando `votes_snapshot_available = true` e não há linhas em `poll_votes`:

- as duas contagens são zero;
- `participants` é `[]`;
- a UI informa que nenhum participante votou.

Esses estados não são tratados como equivalentes.

## Filtro temporal

Os timestamps continuam como Unix epoch em segundos. As datas da UI representam dias civis em `America/Sao_Paulo`.

O intervalo é semiaberto:

```text
[início local de from, início local do dia posterior a to)
```

O offset é obtido com `Intl.DateTimeFormat` para o instante correspondente. Isso evita interpretar a data como meia-noite UTC e também considera mudanças históricas de horário de verão.

## Frontend

- grupos são carregados exclusivamente por `GET /api/local/groups`;
- o parâmetro `?groupId=...` e `easyPoll.lastGroupId` restauram uma seleção local válida;
- busca usa debounce de 350 ms;
- mudança de busca, data ou tamanho volta à página 1;
- `AbortController` impede uma resposta antiga de sobrescrever a busca atual;
- somente a página atual é solicitada ao servidor;
- detalhes são carregados apenas ao abrir o modal;
- filtros são preservados após sincronização;
- `sync/newer` volta à primeira página para mostrar polls novas;
- `sync/older` mantém a página atual;
- abrir `/history` não inicia sincronização.

## Privacidade e independência do WhatsApp

O repositório consulta somente tabelas de domínio relacionadas a enquetes. Não existem campos de corpo, caption, mídia ou texto de conversas comuns no caminho de leitura.

Os testes instanciam as APIs com SQLite populado e sem `WhatsAppService` ou `HistoryService`, verificando ainda que `whatsapp-web.js` não foi carregado. Um teste com banco em arquivo fecha e reabre a conexão antes de repetir listagem e detalhe.

## Cobertura da Fase 9

Os testes cobrem ordenação básica e estável, paginação 60/25, busca e caracteres especiais, filtro próximo da meia-noite em São Paulo, múltiplas respostas, snapshots indisponível e vazio, detalhe, opções duplicadas, autor ausente, isolamento entre grupos, reinício, parâmetros inválidos e APIs sem WhatsApp.

Uma medição simples popula 1.000 polls e 20.000 seleções e exige que a primeira página seja carregada em menos de cinco segundos, usando duas queries fixas.

## Limites deliberados

- não há FTS5, cache, exportação, edição ou exclusão;
- não há router frontend ou deep link para o modal;
- a busca segue as regras nativas de case folding do SQLite, adequadas à busca simples desta fase;
- disponibilidade completa do histórico continua limitada ao que sincronizações explícitas conseguiram persistir.
