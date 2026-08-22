# Fase 8 — Stats persistentes

As estatísticas do EasyPoll agora podem ser calculadas somente com os dados locais do SQLite.
A abertura da página `/stats` não consulta o WhatsApp, não prepara histórico e não inicia uma
sincronização.

## Fluxo

```text
SQLite
  -> StatsRepository
  -> PollAnalysisInput
  -> StatsQueryService
  -> StatsService
  -> GET /api/groups/:groupId/stats
```

`StatsService` continua sendo uma função pura de cálculo. `StatsRepository` adapta as linhas
persistidas ao domínio que ele já consumia e `StatsQueryService` apenas orquestra a leitura e o
cálculo.

Para um grupo existente, o dataset usa quatro queries fixas:

1. grupo e `sync_state`;
2. polls e seus criadores;
3. opções ordenadas por `position`;
4. votos, membros e opções ligadas por suas chaves reais.

As coleções são agrupadas em memória. Não há uma query por poll, opção ou membro, nem uma lista
`IN` proporcional à quantidade de polls.

## Snapshot de votos

A migration `0002_foamy_morg.sql` adiciona às polls:

- `votes_snapshot_available`, com default seguro `false`;
- `votes_snapshot_at`, em Unix epoch seconds.

Um snapshot só é marcado como disponível depois que seus votos foram mapeados e substituídos com
sucesso, dentro da mesma transação. Um snapshot válido pode conter zero votos. Uma falha posterior
não apaga votos, disponibilidade ou timestamp do último snapshot válido.

Polls existentes antes da migration recebem `false`; a aplicação não infere disponibilidade de
linhas antigas. Uma nova sincronização bem-sucedida passa a qualificá-las para métricas de votos.

## APIs locais

- `GET /api/local/groups`: lista grupos armazenados, quantidade de polls e última sincronização;
- `GET /api/groups/:groupId/stats`: retorna `stats` e `localData` somente a partir do SQLite;
- `GET /api/stats`: permanece disponível como fluxo legado em memória nesta fase.

## Limitação preservada

O vínculo persistido de um voto com uma opção usa `poll_votes.option_id`, inclusive quando duas
opções têm o mesmo texto. Depois dessa associação inequívoca, a adaptação para o contrato atual do
`StatsService` usa texto. Portanto, as fórmulas atuais ainda não distinguem duas opções visualmente
iguais; a adaptação também preserva a deduplicação de textos que o fluxo em memória já fazia.
Corrigir essa representação exigiria mudar o domínio estatístico e ficou fora da Fase 8.

Não foi criado cache ou tabela de estatísticas pré-calculadas.
