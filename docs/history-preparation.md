# Preparação experimental do histórico

## O que existe na versão instalada

A versão efetivamente instalada é `whatsapp-web.js` 1.34.7.

Em `src/structures/Chat.js`, `Chat#fetchMessages({ limit })` obtém o modelo com
`window.WWebJS.getChat(chatId, { getAsModel: false })`, lê `chat.msgs` e chama
`WAWebChatLoadMessages.loadEarlierMsgs({ chat })` repetidamente até atingir o limite
ou a API não retornar mensagens. Logo, chamadas repetidas de `fetchMessages()` não
são uma paginação diferente: cada chamada já executa internamente esse loop.

A versão também oferece `client.interface.openChatWindow(chatId)`, implementado com
`WAWebCmd.Cmd.openChatBottom({ chat })`. Esse método altera o chat ativo. Ele não chama
`sendSeen` explicitamente, mas abrir um chat pode ter efeitos de interface/leitura no
WhatsApp Web; por isso não faz parte da estratégia automática inicial.

Não foi encontrada uma API pública independente de “history sync” que garanta
baixar todo o histórico de um grupo.

## Estratégia implementada

O botão **Preparar histórico** chama, uma página por tentativa, a mesma API interna
usada por `Chat#fetchMessages`: `loadEarlierMsgs({ chat })`.

Após cada chamada, o EasyPoll aguarda 1,5 segundo e mede novamente os modelos não
notificativos em `chat.msgs`. A preparação termina ao atingir o alvo escolhido (até
500000), após três tentativas sem crescimento, após dez minutos, por cancelamento ou
por erro.

A contagem é conservadora: representa modelos disponíveis na coleção do chat nesta
sessão, não a quantidade total do grupo. Nenhuma mensagem é enviada ao frontend ou
persistida. Não há abertura de chat, scroll de DOM, envio de mensagem, download de
anexo ou chamada para marcar como lido.

## Experimentos executados em 20/08/2026

Uma instância local já conectada permitiu testes reais, mas não havia indicação de
qual grupo conhecido deveria ser usado. Foram registradas somente métricas.

### Grupo 1 da lista

- mensagens inicialmente disponíveis: 0;
- scanner antes (limite 100): 0 mensagens, 0 enquetes;
- preparação: estabilizada após 3 tentativas, 0 mensagens;
- scanner depois (limite 500): 0 mensagens, 0 enquetes.

### Maior contagem numa amostra dos primeiros 25 grupos

- mensagens inicialmente disponíveis: 1;
- scanner antes (limite 100): 1 mensagem, 0 enquetes;
- preparação: estabilizada após 3 tentativas, 1 mensagem;
- scanner depois (limite 500): 1 mensagem, 0 enquetes.

O scanner anterior também usa `fetchMessages` e, portanto, já tenta
`loadEarlierMsgs`; ele é uma possível interferência no comparativo.

## Conclusão atual

Um teste dirigido posterior, em um grupo conhecido, **comprovou a hipótese
principal**:

- disponibilidade inicial: 1 mensagem;
- 20 chamadas bem-sucedidas a `loadEarlierMsgs`;
- 50 mensagens adicionais disponibilizadas por tentativa;
- disponibilidade final: 1001 mensagens;
- scanner com limite 1000: 1000 mensagens analisadas e 25 enquetes encontradas;
- IDs recuperados para as 25 enquetes.

O alvo de 1000 terminou em 1001 porque a disponibilidade inicial era 1 e a API
interna retornou páginas indivisíveis de 50 mensagens. Isso é esperado: o alvo é um
limite mínimo de parada, não uma promessa de contagem exata.

Esse resultado demonstra que, ao menos em algumas sessões e grupos, chamar
`loadEarlierMsgs` iterativamente faz o WhatsApp Web disponibilizar mais histórico
antes do scanner. Os dois testes anteriores sem crescimento continuam relevantes:
o comportamento depende do grupo e do estado da sessão, portanto a funcionalidade
deve permanecer experimental e nunca afirmar que obteve o histórico completo.

A hipótese de abrir/ativar o chat não precisou ser testada: a estratégia menos
invasiva foi suficiente. Ela permanece fora da implementação.

## Roteiro para validação dirigida

1. Reinicie/conecte o EasyPoll e escolha um grupo conhecido por ter muito histórico
   e enquetes antigas.
2. Anote a contagem mostrada sem executar o scanner.
3. Clique em **Preparar histórico** e aguarde o estado terminal.
4. Anote contagem, estado e número de tentativas.
5. Execute **Analisar enquetes** e registre mensagens/enquetes encontradas.
6. Compare com uma sessão recém-conectada. Use “histórico disponível nesta sessão”,
   nunca “histórico completo”.

Os logs `[HistorySync]` mostram contagens e a estratégia, sem registrar conteúdo.
