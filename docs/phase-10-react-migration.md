# Fase 10 — migração do frontend para React

## Escopo

A Fase 10 substitui as três páginas em HTML, CSS e JavaScript vanilla por uma
aplicação React + TypeScript construída com Vite. Os endpoints REST, o backend
CommonJS, o SQLite, as migrations, os serviços de estatística e sincronização e
a integração com `whatsapp-web.js` permanecem com os mesmos contratos e
comportamentos.

## Arquitetura e estrutura

O backend continua em `src/`. O frontend fica isolado em `frontend/`:

```text
frontend/
├── index.html
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── api/
    │   ├── apiClient.ts
    │   └── easypollApi.ts
    ├── components/
    │   ├── BrandMark.tsx
    │   ├── MemberAvatar.tsx
    │   ├── Navigation.tsx
    │   └── Toast.tsx
    ├── hooks/
    │   ├── usePageMetadata.ts
    │   └── useToast.ts
    ├── pages/
    │   ├── CreatePollPage.tsx
    │   ├── HistoryPage.tsx
    │   └── StatsPage.tsx
    ├── styles/
    │   ├── global.css
    │   ├── history.css
    │   └── stats.css
    ├── types/api.ts
    └── utils/
        ├── format.ts
        └── storage.ts
```

`App.tsx` resolve o conjunto pequeno e estável de URLs pelo `pathname`. Não foi
necessário adicionar uma biblioteca de routing. As URLs preservadas são `/`,
`/history` e `/stats`; parâmetros `groupId` continuam sendo lidos e escritos.

## API e tipos

`apiClient.ts` centraliza `fetch`, JSON, headers, cache, `AbortSignal` e a
conversão de erros HTTP para `ApiError`. `easypollApi.ts` expõe funções tipadas
para os contratos existentes. Os componentes não conhecem Drizzle,
`better-sqlite3` nem tipos internos do WhatsApp.

`types/api.ts` modela status e QR, grupos atuais e locais, membros, envio de
enquete, scan, preparo e sincronização, histórico paginado e detalhado e o
resultado completo de Stats. O `tsconfig` do frontend usa `strict: true`; o
frontend não usa `any` para contornar contratos.

## Desenvolvimento

```bash
npm run dev
```

Esse comando usa `concurrently` para iniciar:

- `npm run dev:server`: Express/TypeScript em watch, na porta 3000;
- `npm run dev:web`: Vite com Fast Refresh/HMR, em `http://localhost:5173`.

O Vite encaminha `/api` para `http://localhost:3000`. As chamadas do frontend
permanecem relativas e não foi adicionado CORS. O `cacheDir` do Vite fica no
`node_modules` da raiz para que backend e frontend continuem usando uma única
instalação. O carregador `runner` evita dependência de sintaxe ou shell
específico de sistema operacional para carregar `vite.config.ts`.

## Typecheck, build e produção

Scripts principais:

```text
npm run typecheck       backend + frontend
npm run build           backend + typecheck frontend + bundle Vite
npm run check           typecheck completo + bundle Vite
npm test                suíte Node existente
npm run smoke:web       smoke headless do build já gerado
npm start               somente Express/Node compilado
```

Também existem `typecheck:server`, `typecheck:web`, `build:server`,
`build:web`, `dev:server` e `dev:web`.

O Vite grava em `frontend/dist`. Em produção, o Express serve essa pasta antes
das rotas de fallback. Todas as rotas `/api/*` são montadas primeiro; uma API
inexistente recebe o 404 JSON existente. Somente depois desse 404 o fallback
envia `frontend/dist/index.html`, permitindo refresh direto em `/history` e
`/stats`. `npm start` não inicia nem depende do servidor Vite.

## Compatibilidade preservada

As duas chaves existentes de `localStorage` foram mantidas:

- `easyPoll.lastGroupId` — compartilhada por criação, Histórico e Stats;
- `easyPoll.favoriteGroups` — IDs dos grupos favoritos.

A página principal mantém status/QR/logout, busca e favoritos, formulário e
atalho `Ctrl+Enter`, 2 a 12 opções, importação em lote, múltiplas respostas,
seletor de membros, nomes duplicados, fotos lazy com três downloads simultâneos,
preparo, scan, JSON bruto e sincronização/cancelamento.

Histórico mantém grupos SQLite, busca com debounce de 350 ms, filtros de data,
page size, paginação, contagens e snapshots, detalhe sob demanda,
`AbortController`, proteção contra respostas antigas, sync e estados de
loading/vazio/erro.

Stats continua apenas apresentando o `StatsResult` calculado no backend. Todos
os resumos, cards, rankings de participação, comportamento, tempo, afinidade,
enquetes e atividade foram mantidos. Nenhuma fórmula estatística foi duplicada
no React.

## CSS e legado

Os três arquivos CSS foram copiados byte a byte para `frontend/src/styles` e
passaram a ser empacotados pelo Vite. Não houve redesign, framework CSS ou
CSS-in-JS. Após o build, typecheck e smoke test das três páginas, os HTMLs,
JavaScripts e CSSs de `public/` foram removidos porque deixaram de ser usados.

## Validação e limitações

`scripts/frontend-smoke.js` serve o build com respostas locais seguras, abre as
três URLs em Chromium headless, confirma que o React montou e verifica erros de
console, de página e de assets. Ele também confirma que uma API inexistente é
404 JSON. O script nunca chama endpoints mutáveis e nunca envia mensagens ou
enquetes.

Uma sessão real ainda é necessária para validar manualmente QR/Login/LocalAuth,
grupos e fotos retornados pelo WhatsApp, preparo e sincronização com histórico
real, extração de votos e o clique final de envio. O envio não deve ser incluído
em automação.

Nenhum schema ou migration foi alterado. Os serviços de persistência,
histórico, Stats e WhatsApp e seus workarounds não foram modificados. A Fase 11
pode evoluir a componentização das páginas grandes, sem exigir outra migração
de tecnologia.
