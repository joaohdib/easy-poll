# Fase 7 — sincronização incremental bidirecional

O EasyPoll mantém `processed_messages.message_id` como fonte de verdade para
deduplicação. Timestamps continuam sendo métricas e limites visuais; mensagens
com o mesmo timestamp são distinguidas pelo ID.

## Novidades

`POST /api/groups/:groupId/sync/newer` começa com as 250 mensagens mais
recentes e dobra a janela até 5.000. Uma fronteira é considerada segura quando:

- o ID da mensagem local mais recente aparece na janela; ou
- a borda antiga da janela contém uma sequência contínua de IDs conhecidos
  (até 20, reduzida quando o baseline é menor).

Encontrar apenas um ID conhecido no meio da janela não encerra a busca. Se a
fronteira não for encontrada no limite, nenhum delta incompleto é persistido e
`boundaryNotFound` é retornado.

Somente mensagens desconhecidas geram metadata nova. Polls desconhecidas e até
50 polls conhecidas presentes na janela final são normalizadas pelo fluxo já
existente, permitindo reconciliar snapshots recentes de votos sem duplicar a
poll.

## Histórico anterior

`POST /api/groups/:groupId/sync/older` usa 1.000 mensagens novas por padrão e
aceita até 5.000. O serviço recupera por ID a mensagem local mais antiga usando
o mesmo `WAWebCollections.Msg.getMessagesById` empregado pelo
`whatsapp-web.js`, confirma que ela está na coleção do chat e chama
`WAWebChatLoadMessages.loadEarlierMsgs` página a página.

Cada página tem seus IDs consultados em batch. Overlaps não contam para o
limite. Se uma página ultrapassa o tamanho solicitado, a parte mais próxima da
fronteira conhecida é persistida, mantendo o intervalo local contíguo. Retorno
vazio ou três páginas sem novos IDs sinalizam que nenhuma mensagem anterior
adicional foi disponibilizada nesta sessão; isso não afirma que a criação real
do grupo foi alcançada.

Se o WhatsApp Web não conseguir reidratar o ID mais antigo, o fluxo retorna um
erro explícito e não faz um `fetchMessages` gigante como fallback.

## Persistência, segurança e limites

- Consultas `IN (...)` são divididas em chunks de 250 IDs.
- Ambos os sentidos terminam em `PersistenceService.persistScan`, dentro da
  transação existente.
- `sync_state.messages_processed` permanece o total de IDs únicos do grupo.
- Scan completo, preparação e sincronizações incrementais usam um lock global
  conservador, pois compartilham os modelos do mesmo WhatsApp Web.
- Operações incrementais têm timeout de dois minutos; páginas antigas têm
  timeout de 30 segundos e podem ser canceladas.
- Nenhum corpo, legenda ou mídia de mensagem comum cruza o DTO de persistência.
- O schema não mudou e nenhuma migration foi criada.

## Limitação de votos antigos

Uma poll conhecida é reconciliada quando sua mensagem está na janela recente.
Polls muito antigas fora dessa janela não são atualizadas nesta fase: o projeto
não possui um watcher persistente de votos e não percorre dezenas de milhares
de mensagens nem dispara centenas de consultas de polls por ID. O scan manual
continua disponível como fallback consciente.

## Endpoints

- `GET /api/groups/:groupId/sync-status`
- `POST /api/groups/:groupId/sync/newer`
- `POST /api/groups/:groupId/sync/older` com `{ "limit": 1000 }` opcional
- `DELETE /api/groups/:groupId/sync` para solicitar cancelamento

Stats continua usando o resultado em memória do scan atual. A Fase 8 não faz
parte desta implementação.
