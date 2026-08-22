# Fase 6 — persistência do scanner

O scanner continua produzindo e retornando o mesmo `PollScanResult` em memória. Depois que mensagens, enquetes e votos foram normalizados, o `HistoryService` monta um DTO interno mínimo e chama o `PersistenceService`.

## Limite de dados

O DTO de enquetes contém apenas tipos de domínio do EasyPoll. Para mensagens comuns, o DTO contém exclusivamente `id`, `groupId`, `type` e `timestamp`; corpo, legenda, mídia e demais conteúdo de conversa não atravessam a fronteira de persistência.

## Transação

Cada resultado lógico de scan é persistido em uma única transação SQLite: grupo, membros relevantes, enquetes, opções, votos, metadados de mensagens processadas e `sync_state`. Uma falha em qualquer etapa reverte o scan inteiro. Logs de sucesso são emitidos somente depois do commit.

## Reconciliação

- grupos usam o ID real do WhatsApp e atualizam o nome no conflito;
- membros usam o ID real; nomes ausentes não sobrescrevem nomes conhecidos;
- enquetes usam `message_id`; autor ou timestamp ausentes não apagam valores conhecidos;
- opções preservam IDs internos, usando primeiro `whatsapp_local_id` e depois posição;
- votos recuperados com sucesso são um snapshot autoritativo;
- votos indisponíveis, ou escolhas que não podem ser mapeadas sem ambiguidade, preservam o último snapshot válido;
- respostas múltiplas permanecem uma linha por combinação de votante e opção.

## Estado do scan

`processed_messages` é inserido em lotes de 250 com conflito ignorado. `messages_processed`, `oldest_processed_timestamp` e `newest_processed_timestamp` são recalculados a partir das linhas únicas persistidas para o grupo. Nesta fase esses dados ainda não limitam `fetchMessages()`; serão a base da Fase 7.
