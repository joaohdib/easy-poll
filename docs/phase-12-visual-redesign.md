# Fase 12 — Grande redesign visual

## Direção visual

A Fase 12 transforma o EasyPoll em uma aplicação desktop-first, responsiva e com identidade própria. A linguagem usa superfícies claras, tipografia de sistema, verde emerald/mint como acento e hierarquia baseada principalmente em espaço, contraste e escala. A referência ao WhatsApp está limitada ao contexto e à família cromática; layout, navegação e componentes são próprios do EasyPoll.

O redesign é exclusivamente de apresentação. APIs, DTOs, regras de negócio, SQLite, sincronização, estatísticas e integração com WhatsApp não foram alterados.

## Stack e dependências

- Tailwind CSS 4.3.3 com a integração oficial `@tailwindcss/vite` 4.3.3.
- shadcn/ui configurado em `components.json` para o frontend Vite existente.
- Radix Dialog 1.1.23 para a primitive de Sheet e Radix Slot 1.3.3 para composição de Button.
- `class-variance-authority`, `clsx` e `tailwind-merge` para variantes e composição de classes.
- Lucide React 1.33.0 como biblioteca única de ícones.

Não foram adicionadas bibliotecas de estado, forms, charts, animação ou outro framework CSS. `npm audit fix` não foi executado.

## Configuração

O plugin Tailwind foi acrescentado ao array existente de plugins de `frontend/vite.config.ts`, depois do plugin React. Foram preservados:

- `cacheDir`;
- proxy `/api`;
- `127.0.0.1`;
- leitura de `PORT`;
- porta e `strictPort` do Vite;
- fluxo `wait-for-backend` dos scripts existentes.

O alias `@/` aponta para `frontend/src/` em TypeScript e Vite. A configuração usa `fileURLToPath(import.meta.url)` por compatibilidade com o config runner ESM e não depende de `__dirname`.

## Primitives shadcn adicionadas

- `Button`, com variantes `primary`, `secondary`, `ghost` e `destructive`;
- `Skeleton`;
- `Sheet`, usado na navegação mobile;
- helper `cn`.

Os componentes específicos do EasyPoll permanecem customizados. Native dialogs existentes foram mantidos para preservar seus fluxos e receberam a nova linguagem visual. O detalhe do histórico é apresentado como Sheet lateral no desktop e Sheet inferior no mobile.

## Tokens visuais

Os tokens semânticos estão centralizados em `frontend/src/styles/global.css`:

- `background` e `foreground`;
- `surface`, `surface-muted` e `surface-strong`;
- `primary`, `primary-hover`, `primary-foreground` e `primary-soft`;
- `border` e `border-strong`;
- `muted` e `muted-foreground`;
- `success`, `warning` e `danger`, com superfícies semânticas;
- `focus-ring`;
- sombras discretas `shadow-sm` e `shadow-md`;
- accents controlados para Stats.

A paleta combina canvas cinza-esverdeado `#f5f7f4`, superfícies brancas, texto `#17231d`, emerald principal `#137a53` e mint `#e6f4ed`. Warning, danger, apricot e lilac aparecem somente em contextos semânticos ou categorias de Stats.

A tipografia usa apenas a pilha de sistema (Inter quando disponível, seguida de fontes nativas). Títulos possuem tracking mais fechado; labels, metadata, métricas e posições de ranking possuem escalas distintas. Nenhuma fonte remota ou serviço de tracking foi introduzido.

## AppShell e navegação

No desktop, uma sidebar fixa de 232 px contém BrandMark, EasyPoll, três rotas e a indicação “Local e privado”. A página ativa usa marcador lateral, fundo suave, ícone e peso tipográfico, não apenas cor.

Abaixo de 1024 px, a sidebar desaparece e dá lugar a um header compacto. O menu abre em Sheet lateral acessível. A estrutura de rotas aceita uma futura quarta entrada sem adicionar Settings nesta fase.

O conteúdo usa largura máxima por contexto: CreatePoll é controlado para composição; History é ligeiramente mais estreito; Stats pode ocupar uma largura maior.

## CreatePoll

- Status do WhatsApp compacto, com indicador, texto principal, ajuda e ações sem ocupar uma superfície excessiva quando conectado.
- Estado QR em painel limpo, com instruções e contraste adequado.
- Workspace em duas colunas no desktop: compositor principal e ferramentas de histórico/contexto; empilhamento natural em tablet/mobile.
- GroupSelector com busca iconográfica, refresh, favorito, seleção e hover distintos.
- Pergunta maior, contador de caracteres e foco claro.
- Opções numeradas, áreas editáveis amplas, remoção discreta e ações secundárias consistentes.
- Importação em massa e seleção de membros preservadas.
- Ação “Enviar enquete” é a única primary forte do compositor.
- Múltiplas respostas, limpar formulário e atalho de teclado foram preservados.

## MemberSelector e avatars

O modal possui header, busca, contador, ações rápidas, lista rolável, limite e footer bem separados. Seleção, foco e disabled têm estados visíveis. Avatares mantêm carregamento limitado, privacidade e fallback por iniciais, com dimensões e cores consistentes.

## Histórico

- Overview único reúne seletor de grupo, quantidade armazenada, cobertura local, última sincronização e controles incrementais.
- Filtros são agrupados em uma superfície discreta; busca recebe mais largura que datas.
- A lista é apresentada como biblioteca, com pergunta em primeiro plano e metadata/counts em segundo plano.
- PollCard inteiro é um botão acessível, com feedback de hover/foco e acesso explícito ao detalhe.
- Empty, loading e error states possuem tratamentos próprios; loading usa skeleton sem percentual inventado.
- PollDetails usa leitura lateral no desktop e inferior no mobile. Opções mostram contagem e barras CSS relativas, sem inventar percentuais. Participantes e múltiplas escolhas continuam explícitos.
- Snapshot indisponível e snapshot vazio permanecem visualmente distintos pelos mesmos dados do backend.

## Estatísticas

Stats recebeu uma atmosfera editorial/social-insights: hero emerald controlado, resumo contínuo e seções com ritmos distintos. Não há recálculo no frontend.

Inventário preservado e validado:

- 6 indicadores de resumo;
- 2 destaques de participação;
- ranking completo de participação;
- 4 métricas de comportamento;
- 3 métricas de velocidade;
- destaque da dupla mais oposta;
- 2 rankings de afinidade/oposição;
- 4 destaques de enquetes/criadores;
- 2 distribuições de atividade.

Isso corresponde a 16 `.stat-card`, 2 rankings de pares e 6 resumos no fixture de smoke. O teste falha se algum desses blocos desaparecer.

Rankings usam posição, nome, amostra, valor e barra suave. O top 3 recebe destaque de posição sem depender de medalhas. Afinidade e oposição ficam lado a lado no desktop e empilhadas no mobile. Emojis foram substituídos por Lucide como linguagem principal de ícones.

## Responsividade, movimento e acessibilidade

Foram validados 1440×900, 1280×800, 768×1024 e 390×844. Em todos os 12 pares rota/viewport, o smoke confirma que `scrollWidth` não excede `clientWidth`.

- Sidebar vira Sheet abaixo de 1024 px.
- Grids de CreatePoll, filtros, resumos e Stats são reorganizados explicitamente.
- PollDetails vira Sheet inferior no mobile.
- Rankings não dependem de tabela e quebram em layouts menores.
- Nomes e perguntas usam wrap ou truncamento somente onde o conteúdo completo continua acessível.
- Todos os controles mantêm `focus-visible`.
- Microinterações duram aproximadamente 150–200 ms.
- `prefers-reduced-motion` reduz animações e transições não essenciais.

## CSS removido

`frontend/src/styles/history.css` e `frontend/src/styles/stats.css` foram removidos. Os imports correspondentes também foram retirados de `main.tsx`. Tokens, Tailwind e CSS custom necessário por feature agora vivem em um único `global.css`, evitando a convivência com folhas legadas mortas.

## Validação visual

Capturas principais:

- [Create desktop](screenshots/phase-12/create-desktop-1440x900.png)
- [History desktop](screenshots/phase-12/history-desktop-1440x900.png)
- [Stats desktop](screenshots/phase-12/stats-desktop-1440x900.png)
- [Create mobile](screenshots/phase-12/create-mobile-390x844.png)
- [History mobile](screenshots/phase-12/history-mobile-390x844.png)
- [Stats mobile](screenshots/phase-12/stats-mobile-390x844.png)
- [Navegação mobile](screenshots/phase-12/mobile-navigation-390x844.png)
- [MemberSelector mobile](screenshots/phase-12/member-selector-mobile-390x844.png)
- [PollDetails mobile](screenshots/phase-12/poll-details-mobile-390x844.png)
- [Estado QR mockado](screenshots/phase-12/qr-state-notebook-1280x800.png)

As variantes equivalentes para notebook e tablet também estão em `docs/screenshots/phase-12/`.

O modo visual é acionado com `EASYPOLL_VISUAL=1 npm run smoke:web`. Ele usa somente fixtures locais, cria um QR falso e nunca envia mensagens ou enquetes.

## Limitações restantes

- Compatibilidade visual com dados reais extremamente longos foi coberta por regras de wrap/truncate e pelos layouts responsivos, mas continua recomendada uma inspeção manual com o volume real do usuário.
- A integração real de WhatsApp não foi modificada e, portanto, não foi revalidada por envio automatizado. Envio real continua sendo ação manual.
- Não foi criado tema escuro; isso está fora do escopo da Fase 12.

## Preparação para Configurações

AppShell e Navigation usam uma lista declarativa de rotas, então uma futura entrada de Configurações pode ser adicionada sem reconstruir o layout. Tokens, Button variants e Sheet já oferecem a fundação visual necessária. Nenhuma rota, botão morto ou SettingsPage foi criada nesta fase.
