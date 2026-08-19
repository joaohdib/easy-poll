# Resumo do MVP — EasyPoll

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
- Nenhuma leitura ou armazenamento de mensagens e históricos.
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

## API disponível

- `GET /api/status` — retorna o estado da conexão.
- `GET /api/qr` — retorna o QR Code temporário como Data URL.
- `GET /api/groups` — retorna ID e nome dos grupos.
- `GET /api/groups/:groupId/members` — retorna os dados mínimos dos membros do grupo.
- `GET /api/groups/:groupId/members/:memberId/profile-picture` — retorna a foto quando permitida pela privacidade.
- `POST /api/whatsapp/logout` — encerra a sessão local e prepara uma nova conexão por QR Code.
- `POST /api/polls` — valida e envia uma enquete.

Exemplo do corpo de envio:

```json
{
  "groupId": "123456789@g.us",
  "question": "Qual jogo vamos jogar hoje?",
  "options": ["Minecraft", "Valorant", "Gartic"],
  "allowMultipleAnswers": false
}
```

## Estrutura principal

- `src/server.js` — servidor Express, endpoints e validações.
- `src/whatsapp.js` — conexão, grupos, membros e envio de enquetes.
- `public/index.html` — estrutura da interface.
- `public/styles.css` — estilos responsivos.
- `public/app.js` — interação da interface com a API.
- `.wwebjs_auth/` — sessão local do WhatsApp, ignorada pelo Git.
- `README.md` — instruções completas de instalação e uso.

## Limitações e observações

- O projeto atende somente uma conta e execução local.
- O carregamento de membros depende dos metadados fornecidos pelo WhatsApp Web.
- A busca de membros possui timeout e pode solicitar uma nova tentativa se o WhatsApp demorar para responder.
- Podem ser selecionados no máximo 12 membros por causa do limite definido para as opções da enquete.
- O retorno da biblioteca pode não conter o ID da mensagem mesmo quando a enquete foi enviada; uma operação sem exceção é tratada como sucesso.
- `whatsapp-web.js` é uma integração não oficial baseada no WhatsApp Web. Alterações internas do WhatsApp podem afetar o funcionamento.
- Arquivos de sessão e credenciais locais não devem ser versionados ou compartilhados.
