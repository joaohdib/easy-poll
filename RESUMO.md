# Resumo do MVP — EasyPoll

Estado atualizado em 20/08/2026.

## O que está disponível

- Aplicação web local em `http://localhost:3000`.
- Conexão com uma conta do WhatsApp por QR Code.
- Persistência local da sessão com `LocalAuth`.
- Exibição do estado da conexão:
  - desconectado;
  - aguardando QR Code;
  - conectando;
  - conectado;
  - falha na autenticação.
- QR Code exibido diretamente na interface e removido após a conexão.
- Botão **Desconectar** com confirmação, remoção da sessão `LocalAuth` e geração de um novo QR Code.
- Listagem dos grupos disponíveis na conta conectada.
- Atualização manual da lista de grupos.
- Seleção de um único grupo por envio.
- Criação de enquete com:
  - pergunta;
  - opções dinâmicas;
  - adição e remoção de opções;
  - mínimo de 2 e máximo de 12 opções;
  - opção para permitir múltiplas respostas.
- Botão **Selecionar membros**:
  - consulta somente o grupo selecionado;
  - abre um seletor com busca local, contador e seleção de até 12 membros;
  - carrega fotos de perfil sob demanda e usa iniciais quando indisponíveis;
  - permite limpar ou selecionar até 12 membros aleatoriamente;
  - diferencia nomes duplicados;
  - possui limite de tempo para não ficar carregando indefinidamente;
  - não envia a enquete automaticamente.
- Envio manual da enquete pelo botão **Enviar enquete**.
- Feedback de sucesso ou erro na interface.
- Tratamento de desconexão sem derrubar o servidor.
- Recuperação automática limitada quando a inicialização é interrompida por uma navegação do WhatsApp Web, preservando o `LocalAuth`.
- Área **Enquetes anteriores — Experimental**:
  - executa somente mediante clique;
  - usa o grupo atualmente selecionado;
  - permite solicitar 100, 500, 1000 ou um limite personalizado de até 5000 mensagens;
  - identifica exclusivamente mensagens do tipo `poll_creation`;
  - mostra pergunta, data, autor, opções e votos disponíveis;
  - apresenta falhas de votos individualmente, sem interromper as demais enquetes;
  - exibe um resumo e o JSON bruto sanitizado;
  - não salva os resultados.
- Mensagens comuns são carregadas apenas quando necessário para localizar enquetes, descartadas no backend e nunca enviadas ao frontend ou registradas com seu conteúdo.
- Nenhum banco de dados, autenticação própria, envio em massa ou automação de disparos.

## Como executar

```bash
npm install
npm run dev
```

Depois, abrir:

```text
http://localhost:3000
```

## Fluxo de uso

1. Iniciar o projeto.
2. Escanear o QR Code pelo WhatsApp no celular.
3. Aguardar o status **Conectado**.
4. Selecionar um grupo.
5. Digitar manualmente as opções ou clicar em **Selecionar membros**.
6. Informar a pergunta.
7. Configurar se múltiplas respostas são permitidas.
8. Clicar em **Enviar enquete**.

### Analisar enquetes anteriores

1. Aguardar o status **Conectado**.
2. Selecionar um grupo.
3. Na área experimental, começar com o limite de 100 mensagens.
4. Clicar em **Analisar enquetes**.
5. Conferir o resumo, os cards e, se necessário, **Ver JSON bruto**.
6. Aumentar o limite para 500 ou 1000 somente se necessário.

O limite solicitado é um máximo. O WhatsApp Web pode disponibilizar uma quantidade menor de mensagens para a sessão atual.

## API disponível

- `GET /api/status` — retorna o estado da conexão.
- `GET /api/qr` — retorna o QR Code temporário como Data URL.
- `GET /api/groups` — retorna ID e nome dos grupos.
- `GET /api/groups/:groupId/members` — retorna os dados mínimos dos membros do grupo.
- `GET /api/groups/:groupId/members/:memberId/profile-picture` — retorna a foto quando permitida pela privacidade.
- `POST /api/whatsapp/logout` — encerra a sessão local e prepara uma nova conexão por QR Code.
- `POST /api/polls` — valida e envia uma enquete.
- `POST /api/groups/:groupId/polls/scan` — analisa o histórico disponível e retorna somente dados de enquetes, sem persistência.

Exemplo do corpo de envio:

```json
{
  "groupId": "123456789@g.us",
  "question": "Qual jogo vamos jogar hoje?",
  "options": ["Minecraft", "Valorant", "Gartic"],
  "allowMultipleAnswers": false
}
```

Exemplo do corpo da análise experimental:

```json
{
  "limit": 500
}
```

## Estrutura principal

- `src/server.js` — servidor Express, endpoints e validações.
- `src/whatsapp.js` — conexão, grupos, membros, envio e análise experimental de enquetes.
- `public/index.html` — estrutura da interface.
- `public/styles.css` — estilos responsivos.
- `public/app.js` — interação da interface com a API.
- `.wwebjs_auth/` — sessão local do WhatsApp, ignorada pelo Git.
- `README.md` — instruções completas de instalação e uso.

## Limitações e observações

- O projeto atende somente uma conta e execução local.
- A versão instalada e investigada é `whatsapp-web.js` 1.34.7.
- O carregamento de membros depende dos metadados fornecidos pelo WhatsApp Web.
- A busca de membros possui timeout e pode solicitar uma nova tentativa se o WhatsApp demorar para responder.
- Podem ser selecionados no máximo 12 membros por causa do limite definido para as opções da enquete.
- O retorno da biblioteca pode não conter o ID da mensagem mesmo quando a enquete foi enviada; uma operação sem exceção é tratada como sucesso.
- A análise de histórico nunca roda automaticamente e impede duas análises simultâneas no mesmo cliente.
- O endpoint aceita limites de 1 a 5000 mensagens; o padrão é 1000.
- A interface interrompe a espera após três minutos. O backend pode ainda estar concluindo a operação e continuará rejeitando uma segunda análise simultânea.
- `Chat#fetchMessages()` pode retornar menos mensagens que o limite solicitado quando não há mais histórico disponível para a sessão.
- `Client#getChatById()` apresentou uma falha de serialização (`r: r`) com o WhatsApp Web atual. A análise usa uma instância mínima de `Chat`, mantendo o `Chat#fetchMessages()` da versão instalada sem serializar o modelo completo do grupo.
- Os IDs serializados das enquetes podem perder a propriedade `_serialized` ao atravessar o Puppeteer. O EasyPoll os recupera diretamente dos modelos carregados no WhatsApp Web.
- `Client#getPollVotes()` também perdeu esse ID durante uma segunda serialização. A análise replica a consulta da versão 1.34.7 a `WAWebPollsVotesSchema`, passando diretamente o ID já recuperado e sem fazer scraping adicional.
- Em teste real, 500 mensagens disponíveis produziram 10 enquetes reconhecidas, com perguntas, opções, datas e autores. Em uma sessão posterior, pedidos de 100 e 500 mensagens retornaram somente 15 mensagens e uma enquete, demonstrando que a disponibilidade varia por sessão.
- A recuperação efetiva de votos reais ainda precisa ser confirmada depois do último ajuste em `WAWebPollsVotesSchema`. Uma lista vazia pode significar que nenhum voto foi disponibilizado para aquela enquete.
- Os logs da análise incluem somente limite, ID do grupo, contagem por tipo, IDs de enquetes e erros técnicos; não incluem conteúdo de mensagens comuns.
- `whatsapp-web.js` é uma integração não oficial baseada no WhatsApp Web. Alterações internas do WhatsApp podem afetar o funcionamento.
- Arquivos de sessão e credenciais locais não devem ser versionados ou compartilhados.
