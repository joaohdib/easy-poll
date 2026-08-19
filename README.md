# Enquetes no WhatsApp — MVP local

Aplicação web simples para conectar uma conta pelo QR Code, listar seus grupos e enviar uma enquete a **um grupo escolhido manualmente**.

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

## Como enviar uma enquete

1. Selecione um grupo. Use **Atualizar grupos** caso a lista esteja desatualizada.
2. Digite uma pergunta e pelo menos duas opções.
   - Como atalho, clique em **Usar membros do grupo** para preencher as opções com os primeiros 12 participantes do grupo selecionado.
3. Marque **Permitir múltiplas respostas** se desejar.
4. Clique em **Enviar enquete**.

O backend somente envia ao grupo selecionado e apenas depois desse clique. Não há disparos automáticos nem envio em massa.

## API local

- `GET /api/status` — estado atual da conexão
- `GET /api/qr` — QR Code temporário como Data URL
- `GET /api/groups` — grupos da conta conectada
- `GET /api/groups/:groupId/members` — nomes dos primeiros 12 membros do grupo selecionado
- `POST /api/polls` — valida e envia uma enquete

## Limitações e aviso importante

- Este MVP não possui login próprio, banco de dados, deploy ou suporte a múltiplas contas.
- A sessão fica armazenada localmente e qualquer pessoa com acesso à máquina poderá abrir a interface enquanto o servidor estiver ativo.
- O QR Code não é salvo pela aplicação.
- A lista contém somente nomes e IDs de grupos; mensagens e históricos não são lidos ou armazenados.
- O envio depende de o computador, o servidor e a sessão do WhatsApp Web estarem ativos.
- `whatsapp-web.js` é uma integração **não oficial**, baseada na automação do WhatsApp Web. Mudanças internas no WhatsApp podem quebrar o funcionamento sem aviso e o uso está sujeito aos termos e limites da plataforma.

## Solução de problemas

- **O QR Code não aparece:** aguarde alguns segundos e veja o terminal. Confirme que a instalação do Chromium terminou corretamente.
- **Sessão inválida:** pare o servidor, mova ou remova manualmente `.wwebjs_auth/` e inicie novamente para gerar outro QR Code. Isso desconecta apenas esta sessão local.
- **Linux sem interface gráfica:** o Chromium pode exigir bibliotecas adicionais do sistema. Consulte os requisitos do Puppeteer para sua distribuição. Em um contêiner que não ofereça sandbox do Chrome, defina `PUPPETEER_NO_SANDBOX=1`; não use essa opção sem necessidade, pois ela reduz o isolamento do navegador.
- **Porta ocupada:** defina outra porta antes de iniciar, por exemplo `$env:PORT=3001; npm run dev` no PowerShell.
