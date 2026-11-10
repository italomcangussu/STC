# Plano · Evolução do design system, movimento e cognição

> 10/11/2026 · fabuloso-design · PWA standalone (React 19 + Tailwind 4) · superfície **Operar**
> Base: `auditar` no projeto inteiro (166 arquivos, 832 achados: 399 P1 · 324 P2 · 109 P3), `tokens`, `sistema.md` e `direcoes/chave.md`.
> A medição na tela (`capturar`) ainda não foi feita: o app pede login, e a Fase 0 resolve isso.

## Em uma frase

O app tem identidade (saibro, noite, Inter, a chave dos campeonatos já com sistema próprio), mas **não tem primitivos**. Cada tela escreve botão, campo e card à mão, e os 832 achados são o mesmo punhado de defeitos repetido em 166 arquivos. A evolução tira as decisões das telas e as põe no cardápio (tokens) e em 10 primitivos. Depois disso, cada tela migrada herda a correção de graça.

---

## 1. Diagnóstico (medido)

### Achados de causa única: corrigir no sistema, não na tela

| Achado | Números | Causa | Onde se corrige |
|---|---|---|---|
| **Negrito falso** | `font-black` 554× e `font-extrabold` 19×, mas o `index.html` carrega o Inter só em 300–700 | o navegador gera o 800/900 sozinho, borrado e mais largo | token de peso + carregar o que se usa |
| **Animações que não tocam** | `animate-in`, `fade-in`, `zoom-in`, `slide-in-from-*`: 52 usos | são do plugin `tailwindcss-animate`, que não está instalado. Hoje nada disso anima | 4 utilitárias de entrada próprias com os mesmos nomes |
| **Texto abaixo de 12 px** | 295 (`text-[10px]` 166×, `[11px]` 100×, `[9px]` 19×, `[8px]` 7×) | não há degrau "meta" de 12 px no cardápio | escala de texto com `text-meta` |
| **Zoom do iPhone no campo** | 68 campos abaixo de 16 px | não há primitivo de campo | `<Field>` com 16 px fixo |
| **Placeholder no lugar de rótulo** | 48 | idem | `<Field>` com rótulo obrigatório |
| **Alvo pequeno** | 73 | não há botão-ícone de 44 px | `<IconButton>` |
| **Zoom bloqueado** | `user-scalable=no, maximum-scale=1` | viewport | `index.html` (P1 de acessibilidade) |
| **Brilho colorido** | 30 (`shadow-saibro-200` 39×, `drop-shadow` laranja) | sem escala de sombra | 4 sombras em preto transparente |
| **Raios** | 27 valores distintos (`rounded-[2.5rem]`, `[28px]`, `[32px]`, `[40px]`…) | sem personalidade de raio | 4 raios |
| **Tamanhos de texto** | 17 distintos (13 e 15 px, que o `sistema.md` proíbe) | idem | 7 degraus |
| **Durações** | 9 distintas (75 a 1000 ms) e 8 curvas com quique | sem tokens de movimento | 4 durações e 2 curvas |
| **Clicável sem botão** | 19 `<div onClick>` | sem `<Card>` clicável | `<Card as="button">` |

### Cognição (Norman, Krug): onde a pessoa se perde

1. **Toda ação precisa responder, e hoje quase nenhuma responde.** O app inteiro tem **11 toasts**. A maioria das ações de salvar, reservar ou excluir termina em silêncio ou num modal fechando. (Norman 1.4, "sucesso silencioso é proibido".)
2. **Confirmação no lugar de desfazer.** São 94 `useConfirm` e nenhum "Desfazer". A confirmação não pega o lapso: a pessoa confirma no automático. (Norman 1.6.)
3. **A barra de baixo confunde.** O código corta os 5 primeiros itens, e eles são Agenda, Ranking, Desafios, SuperSet e Campeonatos. Três deles usam **o mesmo ícone de troféu** (Similaridade: coisas diferentes parecem iguais). Os rótulos têm 9 px em caixa alta com `tracking-tighter`. O toque encolhe o botão a 75% (`active:scale-75`) e o item ativo brilha em laranja. Perfil, Financeiro e Documentos (que tem selo de pendência) ficam fora. (Hick, Posição serial, Fitts.)
4. **Estados não desenhados.** Há um `LoadingStates` bom (skeleton, shimmer), mas não há vazio nem erro como primitivo. Cada tela improvisa, ou mostra branco.
5. **Botão async sem carregando** e erro genérico ou cru: 6 + 4 + 1 achados no script. O número real é maior; o script só vê o padrão mais óbvio.

### O que já é bom e fica

- **`sistema.md` da chave** (noite, saibro só para ação e "agora", card de 14 px, alvos de 44, mínimo de 12 px). É o embrião do sistema do app todo; a evolução **estende a chave para o app**, não inventa outro mundo.
- **Curva `cubic-bezier(0.32,0.72,0,1)`** e as animações da chave (trilho que cresce, perdedor que esmaece). Isso é movimento com significado.
- **Redução de movimento global.** A regra cobre tudo e mantém o spinner girando (bem pensado). Só falta trocar "zera tudo" por "troca deslocamento por opacidade".
- **Cores em HEX** no `@theme`, de propósito, para o `html2canvas` (PDFs e imagens). **Restrição**: nenhum token novo em `oklch`.
- `Sheet`, `ConfirmDialog`, `Tooltip`, `LoadingStates` e as peças de `components/admin/ui.tsx` (`StatusPill`, `AdminEmpty`, `AdminField`, `StatTile`): são reaproveitadas e promovidas, não reescritas.

---

## 2. Leitura do produto (rascunho do `produto.md`: confirme ou corrija)

- **Quem usa e onde:** sócio do clube de tênis, no celular, muitas vezes **na quadra ou indo para ela**: sol, uma mão, pressa entre um jogo e outro. Admin e professores no celular e às vezes no computador. A lanchonete usa o Klanches no balcão.
- **A tarefa principal:** reservar ou conferir horário de quadra (a Agenda é a tela inicial). Depois vêm desafiar ou conferir o ranking e acompanhar os campeonatos.
- **Pico e fim:** reserva confirmada; desafio vencido e a subida no ranking; avançar na chave; o pagamento reconhecido no financeiro.
- **Marca:** saibro (laranja de quadra de saibro), verde de quadra, noite (o fundo da chave), Inter.
- **Não inventar:** horários, preços, mensalidades, posições, placares. Tudo vem do banco.
- **Tom:** "você", termos do clube (sócio, saibro, desafio, chave, classe).
- **O que faria um resultado bonito parecer errado:** parecer app de banco ou de aposta; laranja em tudo, a ponto de não se saber o que é ação.

---

## 3. A direção: "Quadra"

O sistema da chave vira o do app. São três ideias, todas mensuráveis:

1. **Chão claro, ação em saibro.** As telas de operar ficam em fundo `stone-50`, com superfície branca. O saibro (`saibro-700` no texto branco, 5,18:1) marca só a ação primária, a seleção e o "agora". Laranja decorativo sai. É a mesma regra da chave, "saibro nunca decora", levada ao app inteiro.
2. **Linhas de quadra como estrutura.** Divisória de 1 px `stone-200` e espaço no lugar de borda + sombra + gradiente. A textura de saibro (`bg-clay-pattern`) e o fundo noite ficam para **dois lugares só**: o cabeçalho de competição (chave, ranking) e os momentos de pico.
3. **Movimento que conta o jogo.** O movimento só aparece quando algo mudou de verdade: alguém subiu no ranking, a reserva foi confirmada, o vencedor avançou. Fora disso, retorno de toque de 120 ms e nada mais.

---

## 4. Fases

Cada fase tem um commit próprio. **Refatoração** (o visual muda, a função não) e **evolução** (muda o que a tela faz) ficam em commits separados. Os passos marcados ⚠ mudam comportamento e pedem o seu sim antes.

### Fase 0 · Linha de base (½ dia)

- Escrever `.fabuloso/design/produto.md` a partir da seção 2, depois da sua correção.
- `design.mjs hook instalar`: cada edição de interface passa a ser auditada (P1/P2) e o hook nunca bloqueia.
- Um usuário de teste por papel (sócio, admin, lanchonete) no seed local, para o `capturar` entrar logado.
- `capturar` das rotas Agenda, Ranking, Desafios, Campeonatos, Meu financeiro, Painel Admin e Conversas, em iPhone, Android e pequeno, com `--provas`. Nota da rubrica por tela com `nota`. Esse é o "antes".

### Fase 1 · Cardápio v2: tokens (1 dia)

Tudo em `index.css @theme`, em HEX, documentado em `sistema.md` (que passa a se chamar "Sistema visual · STC", com a chave como uma seção dele).

| Família | Proposta | Hoje |
|---|---|---|
| **Papéis de cor** | `--color-chao` stone-50 · `--color-superficie` white · `--color-linha` stone-200 · `--color-texto` stone-900 · `--color-texto-2` stone-600 · `--color-texto-3` stone-500 (4,8:1, mínimo) · `--color-acao` saibro-700 · `--color-acao-hover` saibro-800 · `--color-acao-suave` saibro-50 · `--color-sucesso` green-700 · `--color-aviso` (âmbar, a criar em HEX) · `--color-erro` red-700 · `--color-info` noite-600 | cores cruas em cada tela |
| **Texto** (razão 1,2) | `meta` 12/16 600 · `sm` 14/20 · `base` 16/24 · `lg` 18/26 · `xl` 20/28 · `2xl` 24/30 · `3xl` 30/36 | 17 tamanhos, mínimo de 8 px |
| **Peso** | 400 · 500 · 600 · 700. Carregar o Inter em **400;500;600;700;800** e remapear `font-black` para 800, só em título de tela e placar | 900 falso em 554 lugares |
| **Raio** | `sm` 8 (chip, campo) · `md` 14 (card, igual à chave) · `lg` 24 (folha, diálogo) · `full` (pílula, avatar) | 27 valores |
| **Sombra** | 4 níveis, duas camadas, preto transparente: `e1` card · `e2` card ao passar o mouse e popover · `e3` folha · `e4` diálogo. Sem sombra colorida | 15+ variantes, brilho laranja |
| **Movimento** | `--ease-saida` `cubic-bezier(0.16,1,0.3,1)` · `--ease-folha` `cubic-bezier(0.32,0.72,0,1)` · `--dur-toque` 120 ms · `--dur-estado` 200 ms · `--dur-entrada` 280 ms · `--dur-contexto` 400 ms. Saída a 75% da entrada | 9 durações, quique |
| **Camadas** | `z-barra` 40 · `z-folha` 50 · `z-dialogo` 60 · `z-toast` 70 | z soltos |
| **Navegador** | `::selection` saibro-100, `caret-color` e `accent-color` saibro-700, anel de foco 2 px saibro-700 com afastamento de 2 px, barra de rolagem fina | padrão do navegador |

Na mesma fase: tirar `user-scalable=no` e `maximum-scale=1` do viewport (o campo de 16 px resolve o zoom que isso tentava evitar) e adicionar ícone `maskable` ao manifest.

### Fase 2 · Primitivos (2–3 dias)

São dez peças em `components/ui/`. Cada uma traz os estados de §7 (padrão, foco, pressionado, desabilitado com motivo, carregando, erro), tem 44 px de alvo e tem teste.

| Primitivo | O que resolve | Reaproveita |
|---|---|---|
| `Button` (primária · secundária · fantasma · destrutiva; `md` 44 / `lg` 52; `loading` embutido, que desabilita e mostra spinner) | Doherty, toque repetido, 1 primária por tela | `LoadingButton` |
| `IconButton` (44×44, `aria-label` obrigatório) | 73 alvos pequenos | `hit-target-44` |
| `Field` + `Input` / `Select` / `Textarea` (rótulo → campo → ajuda → erro; 16 px; `inputMode` por tipo; máscaras de `lib/`) | 68 zooms, 48 placeholders, erro inline | `AdminField`, `maskPhone`, `formatCpf`, `parseBRL` |
| `Card` (estático ou `as="button"`, sobe de `e1` para `e2`) | 19 `div onClick`, card em card | `card-court` |
| `ListRow` (56 px, valor à direita `tabular-nums`) | listas de ranking, financeiro, alunos | — |
| `Chip` / `Segmented` + utilidade `faixa-rolavel` | abas e filtros que rolam nos dois eixos (16 achados) | `ChipGroup` |
| `StatusPill` (ícone + texto, nunca só cor) | estado só por cor | `admin/ui.tsx` |
| `EmptyState` (5 tipos: primeira vez · tudo feito · sem resultado · sem permissão · erro ao carregar) | telas brancas | `AdminEmpty` |
| `notify` (sobre o `sonner`: `notify.feito("Reserva confirmada", { desfazer })`, `notify.erro(causa, saída)`) | sucesso silencioso, erro cru | `sonner` |
| `Sheet` v2 (alça, arrastar para fechar, `--ease-folha`, foco preso, devolve o foco) | modais no celular | `Sheet`, `ConfirmDialog` |

**Codemod de baixo risco**, feito na mesma fase: `text-[8–11px]` → `text-meta`; `font-black` → `font-extrabold` (800 de verdade); `rounded-[2rem|28px|32px|40px|2.5rem]` → `rounded-lg`; `shadow-saibro-*` → `shadow-e1`. É só visual e cabe num commit revisável por diff.

### Fase 3 · Movimento e efeitos (1–2 dias)

**Vocabulário**: seis movimentos, e nenhuma tela inventa outro.

| Movimento | Quando | Como |
|---|---|---|
| **Toque** | todo controle | `scale(0.97)` + fundo um tom acima, em `--dur-toque`. Sai o `active:scale-75` |
| **Entrada** | lista, card ou bloco que aparece | `enter-up`: 8 px + opacidade, `--dur-entrada`. A cascata (`stagger-cascade`) só **na primeira carga** da tela, até 6 itens |
| **Folha** | Sheet e diálogo | sobe 100% em 400 ms `--ease-folha`; sai em 300 ms |
| **Troca de tela** | `changeView` no `App.tsx` | **View Transitions API** (`document.startViewTransition`, já no Safari 18 e no Chrome): o conteúdo cruza em 200 ms e o item da barra de baixo desliza entre as abas. Sem suporte, a troca é seca, como hoje |
| **Mudança de valor** | placar, posição no ranking, saldo | número com `tabular-nums` que troca com um deslize vertical de 120 ms; a linha que mudou acende `acao-suave` por 1,2 s |
| **Reordenar** | ranking depois de um desafio | FLIP (medir → inverter → tocar) em `transform`: a linha do vencedor **sobe para a posição nova** |

**Momentos de pico** (Pico-fim). São três, cada um com um toque autoral:

1. **Reserva confirmada**: o horário escolhido na grade "carimba" (escala 0,96 → 1 com o fundo virando `acao`) e o toast diz o que acontece agora ("Quadra 2 · hoje 18h · lembrete 1 h antes").
2. **Subiu no ranking**: a linha sobe (FLIP), e a posição antiga aparece riscada ao lado por 2 s.
3. **Avançou na chave**: já existe (`bracketLandIn`, `bracketLineDraw`). Só ganha os tokens.

**Efeitos que saem** (reflexos de §13): brilho colorido (30), `backdrop-blur` decorativo no menu e nas barras (fica só onde há conteúdo rolando por baixo), quique e `bounce` (8), texto em gradiente (2), faixa lateral colorida (17), `animate-pulse` em coisa que não está carregando.

**Redução de movimento**: deslocamento e escala viram opacidade de 120 ms; o FLIP vira o destaque de fundo; a View Transition vira troca seca. O retorno de toque continua.

**As 52 `animate-in` mortas**: são definidas como utilitárias próprias (`animate-in` + `fade-in` / `zoom-in` / `slide-in-from-bottom-*`) em cima dos tokens. Assim elas passam a funcionar sem nova dependência e sem tocar nos 52 lugares.

### Fase 4 · Cognição: fluxos e navegação (2 dias)

- ⚠ **Barra de baixo com 5 itens por frequência**: Agenda · Ranking · Desafios · Campeonatos · **Mais**. SuperSet e TenisProPlayer entram em Campeonatos ou em Mais; Mais abre uma folha com o resto e mostra o selo de Documentos. Cada item tem ícone próprio (`Calendar`, `ListOrdered`, `Swords`, `Trophy`, `Menu`), rótulo de 12 px sem caixa alta, e o ativo se mostra pela forma (pílula atrás do ícone), não só pela cor. *Muda a navegação: commit separado.*
- **Desfazer no lugar de confirmar**: dos 94 `useConfirm`, o que é reversível (cancelar reserva ainda no prazo, remover da lista, arquivar) vira ação + "Desfazer" no toast por 6 s. O que é irreversível ou caro (excluir campeonato, estornar) mantém o diálogo, com o botão dizendo o verbo. Antes de mexer, vem uma triagem dos 94 em tabela para você aprovar.
- **Toda ação responde**: um inventário das ações de salvar, criar e excluir. Cada uma ganha `Button loading` + `notify.feito` + mensagem de erro com causa e saída.
- ⚠ **Agenda: "o seu agora" no topo** (Posição serial, Zeigarnik): o próximo jogo ou reserva do sócio, e o desafio pendente de resposta, como uma linha acima da grade. É só leitura, com dados que já existem; se algum não existir, fica descrito para a fabuloso.
- **Vazios e erros**: cada lista principal ganha o `EmptyState` certo. O erro ao carregar usa o modelo do `AgendaLoadError`, que já existe.

### Fase 5 · Migração tela a tela (contínua, por impacto)

Ordem pelo número de achados × frequência de uso. Cada tela passa pelo modo Refatorar, com nota antes → depois e meta de ≥ 80%.

1. **Agenda** (94 achados, tela inicial)
2. **Layout** (19: barra, cabeçalho, menu)
3. **Ranking** (14) e **Desafios** (15)
4. **Championships** (26) e **ChampionshipInProgress** (10)
5. **SuperSet** (69)
6. **Meu financeiro** e o `finance/` (9 + 7)
7. **PublicFormPage** (30). É pública e é a primeira impressão de quem ainda não é sócio: superfície Convencer.
8. Admin: **AdminPanel** (32), **AdminForms** (28), **AdminMatchCreator** (20), **AdminStudents** (8)
9. **Conversas** (Inbox 29, MessageBubble 16, Automations 16, ConversationCard 13)
10. O resto, levado pelo hook à medida que cada arquivo for tocado.

### Fase 6 · Modo escuro (opcional, depois da Fase 5)

Os papéis de cor da Fase 1 já deixam o escuro a um bloco de variáveis de distância, e a paleta **noite** já existe e já tem os contrastes medidos. A cena que justifica o escuro é o jogo à noite, sob refletor. Fica como decisão sua depois da migração, não antes.

### Fase 7 · Endurecer e medir (1 dia, e de novo ao fim de cada lote)

`capturar --texto 1.3 --longo --sem-rede --escuro` nas rotas mexidas, com um olhar de iPhone e um de Android. Depois a revisão final de §9 e a nota registrada. O que a emulação não mostra (recorte do iPhone, barra de gesto, PWA instalado) passa por `simulador-ios` ou fica anotado como "conferir no aparelho".

---

## 5. Como saber que deu certo

| Medida | Hoje | Meta |
|---|---|---|
| P1 no projeto | 399 | 0 nos arquivos migrados; o resto só cai |
| Texto < 12 px | 295 | 0 |
| Campo < 16 px | 68 | 0 |
| Raios distintos | 27 | 4 |
| Tamanhos de texto | 17 | 7 |
| Durações | 9 | 4 tokens |
| Peso falso (900 sem a fonte) | 554 | 0 |
| Toasts de "feito" | 11 | uma resposta visível para cada ação de salvar, criar ou excluir |
| Nota da rubrica | só a chave medida (85%) | ≥ 80% em toda tela migrada |

## 6. Riscos e cuidados

- **`html2canvas`**: tokens sempre em HEX, nunca `oklch`. PDF e imagem compartilhada são conferidos depois da Fase 1.
- **Testes de interface**: quando um teste quebrar só por mudança visual, troca-se o seletor, não a regra.
- **Arquivos gigantes** (`Agenda.tsx` com 2.994 linhas): a migração é visual. Quebrar o arquivo é outro trabalho (fabuloso ou uncle-bob) e não entra misturado.
- **Sem nova biblioteca de animação**: CSS, View Transitions e um FLIP de umas 30 linhas bastam. O `framer-motion` somaria ~50 kB para o que o navegador já faz.
- **Fora do escopo desta skill**: qualquer dado novo que um desenho peça (por exemplo, "lembrete 1 h antes" exige que o lembrete exista). Isso é descrito e fica para a fabuloso.

## 7. Decisões que dependem de você

1. A leitura do produto (seção 2) está certa? Em especial a cena "na quadra, no sol, uma mão".
2. ⚠ A barra de baixo pode mudar para Agenda · Ranking · Desafios · Campeonatos · Mais?
3. ⚠ Desfazer no lugar de "tem certeza?" nas ações reversíveis (com a triagem aprovada por você antes)?
4. O modo escuro fica para depois (Fase 6) ou entra junto com os tokens?
