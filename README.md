# EasyPoll — enquetes no WhatsApp

Aplicação web local para conectar uma conta pelo QR Code, montar enquetes rapidamente e enviá-las a **um grupo escolhido manualmente**.

## Requisitos

- Node.js 18 ou superior (Node.js 20 LTS ou mais recente é recomendado)
- npm
- Google Chrome/Chromium, ou espaço para o Puppeteer baixar seu Chromium durante a instalação
- Uma conta ativa no WhatsApp e um celular para escanear o QR Code

## Instalação e execução

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). Para executar sem reinicialização automática, use `npm start`.

## Como conectar

1. Aguarde o QR Code aparecer na página.
2. No celular, abra o WhatsApp.
3. Entre em **Configurações → Aparelhos conectados → Conectar um aparelho**.
4. Escaneie o QR Code exibido pelo aplicativo.
5. Aguarde o status mudar para **Conectado**.

A sessão é mantida em `.wwebjs_auth/`, somente no computador local. Esse diretório, assim como o cache do WhatsApp Web, está no `.gitignore`. Não compartilhe nem versione esses arquivos.

Para encerrar a sessão, use **Desconectar** ao lado do status e confirme a ação. O EasyPoll chama o logout do WhatsApp Web, remove a sessão do `LocalAuth` e gera um novo QR Code para uma futura conexão.

## Como enviar uma enquete

1. Selecione um grupo. É possível buscar e favoritar grupos; o último grupo usado e os favoritos ficam salvos no `localStorage` do navegador.
2. Digite uma pergunta e pelo menos duas opções.
   - Use **Colar várias opções** para importar uma opção por linha (ou uma lista em uma única linha separada por vírgulas/ponto e vírgulas).
   - Como atalho, clique em **Selecionar membros**, busque e marque até 12 participantes e confirme em **Usar selecionados**.
   - Opções já preenchidas só são substituídas depois de uma confirmação. A pergunta e a configuração de múltiplas respostas são preservadas.
3. Marque **Permitir múltiplas respostas** se desejar.
4. Clique em **Enviar enquete** ou use `Ctrl + Enter`. O formulário permanece preenchido após o envio; use **Limpar formulário** quando quiser recomeçar.

O backend somente envia ao grupo selecionado e apenas depois desse clique. Não há disparos automáticos nem envio em massa.

## API local

- `GET /api/status` — estado atual da conexão
- `GET /api/qr` — QR Code temporário como Data URL
- `GET /api/groups` — grupos da conta conectada
- `GET /api/groups/:groupId/members` — dados mínimos dos membros do grupo selecionado
- `GET /api/groups/:groupId/members/:memberId/profile-picture` — URL temporária da foto, quando a privacidade do contato permitir
- `POST /api/whatsapp/logout` — encerra a sessão local e reinicia o cliente para exibir um novo QR Code
- `POST /api/polls` — valida e envia uma enquete

## Limitações e aviso importante

- Este MVP não possui login próprio, banco de dados, deploy ou suporte a múltiplas contas.
- A sessão fica armazenada localmente e qualquer pessoa com acesso à máquina poderá abrir a interface enquanto o servidor estiver ativo.
- O QR Code não é salvo pela aplicação.
- Fotos são carregadas sob demanda, com concorrência limitada, e não são baixadas para disco. Quando indisponíveis, a interface usa iniciais.
- Na versão instalada do `whatsapp-web.js` (1.34.7), o nome público (`pushname`) é priorizado sobre o nome salvo nos contatos. Esse nome pode não ser fornecido pelo WhatsApp Web por disponibilidade ou privacidade; nesse caso, o EasyPoll usa o nome alternativo disponível e, por último, um número parcialmente mascarado.
- O último grupo e os IDs favoritos são as únicas preferências do EasyPoll persistidas pelo frontend. JSON inválido ou grupos removidos são ignorados sem impedir o uso.
- A lista contém somente nomes e IDs de grupos; mensagens e históricos não são lidos ou armazenados.
- O envio depende de o computador, o servidor e a sessão do WhatsApp Web estarem ativos.
- `whatsapp-web.js` é uma integração **não oficial**, baseada na automação do WhatsApp Web. Mudanças internas no WhatsApp podem quebrar o funcionamento sem aviso e o uso está sujeito aos termos e limites da plataforma.

## Publicação no GitHub

Antes de cada publicação, confira `git status --ignored`. Os diretórios `.wwebjs_auth/`, `.wwebjs_cache/`, `node_modules/`, arquivos `.env`, `.npmrc`, chaves privadas e logs estão ignorados. Nunca force a inclusão desses arquivos com `git add -f`.

## Solução de problemas

- **O QR Code não aparece:** aguarde alguns segundos e veja o terminal. Confirme que a instalação do Chromium terminou corretamente.
- **Sessão inválida:** pare o servidor, mova ou remova manualmente `.wwebjs_auth/` e inicie novamente para gerar outro QR Code. Isso desconecta apenas esta sessão local.
- **Linux sem interface gráfica:** o Chromium pode exigir bibliotecas adicionais do sistema. Consulte os requisitos do Puppeteer para sua distribuição. Em um contêiner que não ofereça sandbox do Chrome, defina `PUPPETEER_NO_SANDBOX=1`; não use essa opção sem necessidade, pois ela reduz o isolamento do navegador.
- **Porta ocupada:** defina outra porta antes de iniciar, por exemplo `$env:PORT=3001; npm run dev` no PowerShell.
