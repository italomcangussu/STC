# Auditoria — Estrutura de Campeonatos

> **Escopo:** 28 arquivos · 13.071 linhas (`components/Championship*`, `components/creator/*`,
> `components/admin/*`, `GroupDrawPage`, `NewChampionship`, `TournamentBracketView`,
> `BracketView`, modais de partida, `lib/championship/*`, `lib/championshipUtils`,
> `lib/groupKnockout`).
> **Commit auditado:** `5f39ab0` (após pull de 5 commits do remoto).
> **Lentes:** `/uncle-bob` (qualidade interna) · `/engineering:tech-debt` (priorização) ·
> `/refatorar-ui` (cognição → clareza → execução visual).

---

## Veredito

A **camada de domínio** (`lib/championship/*`) está saudável: 77% de cobertura, zero ciclos de
dependência, funções pequenas, idempotência documentada e um vocabulário de fases explicitamente
acoplado ao banco com comentário de aviso. É código que dá para mexer com confiança.

A **camada de UI** é o oposto: 13 mil linhas em 6 componentes-monstro com **0% de cobertura**,
complexidade ciclomática de 69 a 167, e três gerações de telas de campeonato convivendo — das
quais **1.712 linhas são órfãs** (ninguém importa). O feedback ao usuário está partido em dois
sistemas incompatíveis: o Criador usa `toast` (21 chamadas), todo o resto usa `alert()` nativo
(52 chamadas) e `confirm()` (7) — inclusive para apagar resultados sem volta.

Risco estrutural: não. Dívida localizada e cara: sim, e concentrada na UI.

---

## Saúde por eixo

| Eixo | Nota | Resumo |
|------|:----:|--------|
| Cobertura de testes | 🔴 | 51,4% linhas / 36,6% ramos global. `lib/championship` 77% 🟢 · componentes de campeonato **0%** 🔴 |
| Teste de mutação | ⚪ | Não medido — Stryker não configurado |
| Estrutura de dependências | 🟢 | **0 ciclos** em 139 arquivos. `lib/championship` com I entre 0,00 e 0,42 |
| Complexidade ciclomática | 🔴 | 113/483 funções acima de 5. Topo: 167, 162, 129, 124 |
| Tamanho de módulos/funções | 🔴 | `Championships.tsx` 2.355 LOC · 6 componentes > 950 LOC |
| Duplicação & cheiros | 🟡 | ~2,3% textual, mas **3 implementações de classificação** e 2 sistemas de grupos |
| Feedback / UX (Norman) | 🔴 | 52 `alert()` + 7 `confirm()`; destrutivo sem undo |
| Sistema visual (Refactoring UI) | 🟡 | 126 textos abaixo de 12px; 4 escalas de z-index; paleta documentada ≠ implementada |

---

## Parte 1 — Uncle Bob (qualidade interna)

### 🔴 Alta prioridade

**1. [T1/T3 — sem rede de testes onde mais dói]** `components/*.tsx`
Nenhum componente de campeonato aparece no relatório de cobertura — nenhum teste os importa.
São as funções mais complexas do repositório inteiro:

| Componente | Complexidade | Linhas da função | Cobertura |
|---|:--:|:--:|:--:|
| `ChampionshipInProgress.tsx:38` | **167** | 1.203 | 0% |
| `ChampionshipCreator.tsx:47` | **162** | 1.092 | 0% |
| `ChampionshipAdmin.tsx:132` | **129** | 955 | 0% |
| `GroupDrawPage.tsx:56` | **124** | 1.243 | 0% |
| `NewChampionship.tsx:15` | **93** | 729 | 0% (órfão) |
| `Championships.tsx:56` | **69** | 423 | 0% |

Complexidade 167 significa mais caminhos do que qualquer pessoa consegue segurar na cabeça —
e nenhum deles é verificado. **Refatorar essas telas hoje é aposta, não refatoração.**
Correção: antes de tocar em qualquer uma, escrever testes de caracterização das regras de
negócio embutidas (`canScheduleMatch`, `calculateStandings`, `handleSavePlayedResult`), ou —
melhor — extrair essas regras para `lib/championship/` onde já existe rede.

**2. [G5 — duplicação] Três implementações de classificação**
- `Championships.tsx:551` → `calculateStandings()` (local, sem teste, **e o resultado é
  atribuído a `_standings` e nunca usado** — cálculo morto rodando a cada render)
- `lib/championshipUtils.ts` → `calculateGroupStandings()` (4,25% de cobertura)
- `lib/championshipStandings.ts` → versão testada (85,7%)

Três fontes de verdade para "quem está na frente". Correção: apagar `calculateStandings` e o
`_standings` de `Championships.tsx`, migrar `championshipUtils.calculateGroupStandings` para
delegar a `championshipStandings`.

**3. [G9 — código morto] 1.712 linhas órfãs**
Nenhum arquivo do projeto importa:

| Arquivo | Linhas | Complexidade |
|---|:--:|:--:|
| `components/NewChampionship.tsx` | 743 | 93 |
| `components/AdminChampionshipDetail.tsx` | 497 | 53 |
| `components/AdminTournamentDetails.tsx` | 262 | — |
| `components/AdminTournaments.tsx` | 210 | — |

`AdminTournamentDetails` só é importado por `AdminTournaments`, que é órfão — a subárvore
inteira está morta. Verificado por busca de símbolo **e** de path (não há import dinâmico).
Correção: `git rm`. É a maior redução de superfície pelo menor esforço do repositório.

**4. [G9 — código morto] Fluxo da 4ª Classe no Criador é inalcançável**
`components/ChampionshipCreator.tsx:354` — `const [remainingPool4] = useState<DrawAthlete[]>([])`
declara o estado **sem setter**: o pool é sempre vazio. `setQualifyMatches` (linha 76) só é
chamado com `[]` (linha 307). E `runDrawQualify` salta direto para `setDrawSubStep('done')`
(linha 382), de modo que os blocos `drawSubStep === 'primeira-fase'` (linha 970) e
`'cabecas-de-chave'` (linha 1014) nunca renderizam.

Consequência: ~150 linhas de UI inalcançável, mais `runDrawPrimeiraFase`, `runDrawCabecas`,
`displayPrimeira`, `displayCabecas` e os imports `drawClasse4PrimeiraFase`,
`drawClasse4CabecasDeChave`, `buildClasse4Bracket`. Se algum dia o caminho for reativado,
`drawClasse4PrimeiraFase([])` e `buildClasse4Bracket([], …)` recebem listas vazias.

**5. [T5 — vazamento de recurso]** `ChampionshipCreator.tsx:314-442`
`anim5Ref` / `anim4Ref` guardam `setInterval` de 30 ticks, mas **não há `useEffect` de cleanup**.
Sair do passo de sorteio durante a animação deixa o timer rodando e chamando `setState` em
componente desmontado. Correção: `useEffect(() => () => { clearInterval(anim5Ref.current!) }, [])`.

**6. [Consistência transacional]** `creator/GroupDrawEditor.tsx:68-83`
`saveGroups()` e depois `saveLeagueMatches()` em duas chamadas independentes. Se a segunda
falhar, os grupos ficam gravados e a tela mostra erro — o admin tenta de novo e duplica os
grupos. Mesmo padrão em `ChampionshipInProgress.handleStartChampionship` (cria rodadas, depois
partidas). Correção: RPC transacional no Postgres, ou limpeza compensatória no `catch`.

### 🟡 Média

**7. [G34 — nível de abstração]** `ChampionshipInProgress.tsx:175-297` — `handleStartChampionship`
faz 4 coisas em 120 linhas (criar rodadas → gerar confrontos → resolver ids → inserir), com
**20 `console.log` com emoji** no caminho de produção. O repo tem `lib/logger.ts` (70% de
cobertura) e ele não é usado aqui.

**8. [Código morto + G5]** `Championships.tsx:734` — o avanço do vencedor no cliente usa
`'Oitavas' → 'Quartas' → 'Semi' → 'Final'`, vocabulário que não existe em
`lib/championship/rounds.ts:17-24` (`'oitavas'`, `'quartas'`, `'semifinal'`, `'final'`). Além
disso `saveGenericBracket` (`bracket.ts:210-220`) nem grava `matches.phase`. O bloco nunca
executa — e **não precisa executar**: a propagação real é feita pelo trigger
`trg_propagate_bracket_winner` (`supabase/migrations/20260502000001_resenha_open.sql:93`).
Pior: se executasse, `matches.find(m => !m.playerAId || !m.playerBId)` pega o **primeiro** jogo
com vaga livre, não o correto da chave. Correção: apagar as linhas 730-761.

**9. [Fronteira de camada]** `ChampionshipInProgress.tsx:17` importa `ResultModal` de
`'./Championships'`. Uma tela importa um modal de dentro de outra tela — `Championships.tsx`
exporta simultaneamente uma página e dois modais. Correção: mover `ResultModal` para
`components/ui/`.

**10. [Tipagem]** 83 usos de `any` no escopo, e `eslint.config.js:47` desliga
`@typescript-eslint/no-explicit-any` **e** `no-unused-vars`. É por isso que `_standings` e
`_CLASSES` passam no lint. Não há regra `no-alert` nem `no-console`.

**11. [Dois sistemas paralelos de grupos]**
`lib/championshipUtils` + `lib/groupKnockout` (modelo antigo, 4,25% de cobertura) usados por
`Championships`, `ChampionshipInProgress`, `MatchGenerationModal`, `PublicChampionshipPage`;
`lib/championship/*` (modelo novo, 77%) usado pelo Criador. Convivência intencional durante a
migração, mas sem prazo nem marcação de qual é o caminho vencedor.

### 🟢 Boy Scout

- `ChampionshipInProgress.tsx:30` — `_CLASSES` declarado e nunca usado.
- `isResenhaOpenChampionship` duplicado literalmente em `Championships.tsx:49` e
  `ChampionshipInProgress.tsx:32`.
- `saveBracket` (`resenhaOpenService.ts`) com 7 argumentos; `onRoundsCreated` com 5.
- `DESIGN_SYSTEM.md` documenta `saibro-600: #F26522`, `index.css` define `#ea580c`. A paleta
  documentada **não é** a implementada (vale para 50/500/600/700).

---

## Parte 2 — Refatorar UI (cognição → clareza → execução)

### Nota por tela

| Tela | Nota | Bloqueio principal |
|---|:--:|---|
| `TournamentBracketView` (novo) | **7/10** | Erro de rede indistinguível de chave vazia |
| Criador (`ChampionshipCreator` + `creator/*`) | **6/10** | Sorteio destrutivo sem undo; erros em amarelo no rodapé |
| `Championships` (visão do sócio) | **5/10** | 29 textos abaixo de 12px; `alert()` para erro de agendamento |
| `ChampionshipInProgress` (admin) | **4/10** | `confirm()` nativo apaga resultados sem volta |
| `ChampionshipAdmin` | **4/10** | 14 `alert()`; lote de rodadas despublica sem aviso |
| **Média do módulo** | **5/10** | *funciona, mas faz pensar* |

### LENTE 1 — Cognição (Norman)

❌ **1.4 Feedback — dois sistemas incompatíveis na mesma jornada.**
O admin cria o campeonato no Criador (toast bonito, canto da tela, não bloqueia) e continua a
operação em `ChampionshipInProgress` (`alert()` nativo do browser, modal do sistema, bloqueia
tudo). Mesma pessoa, mesmo fluxo, duas linguagens de resposta.
→ Correção: o `<Toaster />` **já está montado** em `App.tsx:258`. Trocar as 52 chamadas de
`alert()` por `toast.error()` / `toast.success()` é substituição mecânica, sem infraestrutura nova.

❌ **1.6 Design para o erro — destrutivo sem reversão.**
`ChampionshipInProgress.tsx:512` — "Limpar Confrontos" apaga **todas as partidas do campeonato,
inclusive as já jogadas com placar**, atrás de um `confirm()` nativo em caixa alta. Não há undo,
não há confirmação por digitação, não há aviso de quantos resultados serão perdidos.
→ Correção: modal próprio via `StandardModal` (já existe, usado por 10 componentes) exibindo
"*N* confrontos, *M* com resultado registrado" e exigindo digitar o nome do campeonato.

❌ **1.6 — mensagem de erro é jargão de banco.**
`toast.error(e.message)` aparece 21 vezes no Criador propagando texto cru do Postgres/Supabase.
`catch (e: any) { setError([e.message]) }` faz o mesmo em `CreatorRegistration`. O sócio/admin lê
`duplicate key value violates unique constraint "…"`.
→ Correção: mapa causa→correção no modelo de `utils/authErrors.ts`, que o projeto já tem.

❌ **1.6 — `remover()` engole a falha.**
`creator/CreatorRegistration.tsx:157-165` tem `try { … } finally { … }` **sem `catch`**. Se o
delete falhar, `reload()` traz o inscrito de volta e nada explica por quê.

❌ **1.6 — sorteio sobrescreve trabalho manual sem volta.**
`creator/BracketEditor.tsx:71` — "Sortear" reconstrói a chave inteira, descartando alocações
feitas à mão. Sem confirmação, sem desfazer.
→ Correção: guardar `slotsAnteriores` e mostrar toast com ação "Desfazer sorteio" (`sonner`
suporta `toast(msg, { action })`).

❌ **1.6 — ação em lote despublica rodada sem aviso.**
`ChampionshipAdmin.tsx` (novo, commit #4) — selecionar todas + status "Pendente" tira do ar
rodadas que os sócios já estão vendo. Sem confirmação.

❌ **1.4 — exportações longas sem progresso.**
`Championships.handleExportPDF` (linha ~897) roda `html2canvas` + `jsPDF` **sem estado de
loading e sem `try/catch`**. O admin clica e a tela congela por segundos; se falhar, silêncio.
(`GroupDrawPage` acerta isso — tem `exporting` por classe.)

❌ **1.7 — erro disfarçado de vazio.**
`TournamentBracketView.tsx:31-37` usa `try/finally` sem `catch`: falha de rede cai no mesmo
estado visual de "Chave ainda não definida.". O usuário conclui que o admin não sorteou.

✅ **1.2 Modelo conceitual** — `creator/Toggle.tsx` é switch de efeito imediato e é usado como
tal; `aria-pressed` correto nos seletores de classe e formato.
✅ **1.5 Restrições** — `validateFormatShape` + `validateAgainstParticipants` bloqueiam o botão
antes do erro. É o melhor pedaço de UX do módulo.

### LENTE 2 — Clareza (Krug)

❌ **Sem escaneabilidade — 126 textos abaixo do mínimo legível.**
`text-[9px]`, `text-[10px]`, `text-[11px]` no escopo (316 no app inteiro). Concentração em
`Championships.tsx` (29), `ChampionshipInProgress.tsx` (17), `BracketView.tsx` (13),
`NewChampionship.tsx` (10). O padrão é `text-[10px] font-black uppercase tracking-widest` — o
mais difícil de varrer que existe: minúsculo, tudo maiúsculo e ultra-bold ao mesmo tempo.
→ Correção mensurável: `text-[9px]`/`[10px]`/`[11px]` → **`text-xs` (12px)**; abandonar
`font-black uppercase` em rótulo de aba, trocando por `text-sm font-semibold`.

❌ **Trunk test falha no Criador.** Entrando no passo `bracket`, o cabeçalho é só "Criador de
Campeonatos" — não diz de qual campeonato, de qual classe, nem em que passo de quantos.
`ChampionshipCreator` tem 5 passos (`setup → format → registering → drawing → bracket`) e
**nenhum indicador de progresso**; o único step indicator existente é o da 4ª Classe, que é
código morto (achado #4).
→ Correção: breadcrumb `{nome} · {classe} · passo 4 de 5` no cabeçalho de todos os passos.

❌ **Erro fora do campo de visão.** `CreatorRegistration` e `CreatorFormat` acumulam erros num
bloco âmbar no **rodapé** de uma página que rola. Clicar "Fechar inscrições" no meio da lista
pode não mostrar nada visível.
→ Correção: `scrollIntoView` no bloco de erro, ou erro inline junto ao campo culpado.

❌ **Amarelo faz dois papéis.** `bg-amber-50 border-amber-200` é usado tanto para *aviso*
(`BracketEditor` warnings) quanto para *erro bloqueante* (`CreatorRegistration` erros de
validação e de infra). O mesmo visual para "olha isso" e "não dá pra prosseguir".
→ Correção: erro = `bg-red-50 border-red-200 text-red-700` + ícone `AlertCircle`; aviso =
âmbar + `AlertTriangle`. Nunca cor sozinha.

### LENTE 3 — Execução visual (Refactoring UI)

❌ **Alvos de toque abaixo de 44px.** `w-10 h-10` (40px) nos botões de agendar/resultado do card
de partida (`ChampionshipInProgress.tsx:902,910`); `w-7 h-7` nos avatares-botão; `Star size={16}`
sem padding em `CreatorRegistration.tsx:280`; checkbox `w-4 h-4` (16px) na seleção em lote nova
do `ChampionshipAdmin`.
→ Correção: `min-h-[44px] min-w-[44px]` (o projeto **não tem** utilitário `hit-target-44` —
precisa ser criado em `index.css` ou aplicado direto).

❌ **Escala de raio sem disciplina.** No mesmo arquivo convivem `rounded-lg`, `rounded-xl`,
`rounded-2xl`, `rounded-3xl`, `rounded-4xl` e `rounded-[2.5rem]`.
→ Correção: fixar 3 valores — `rounded-xl` (controles), `rounded-2xl` (cards),
`rounded-3xl` (superfícies/modais) — e eliminar `rounded-4xl` e `rounded-[2.5rem]`.

❌ **13 modais feitos à mão.** `fixed inset-0` aparece em `ChampionshipInProgress` (3),
`Championships` (2), `GroupDrawPage` (2), `ChampionshipAdmin`, `NewChampionship`,
`MatchGenerationModal`, `ChampionshipMatchActionModal`, `AdminChampionshipDetail`. Nenhum tem
portal, trava de foco, bloqueio de scroll ou `Escape` — tudo isso já existe pronto em
`components/StandardModal.tsx`, que **10 outros componentes do app usam**.
→ Consequência concreta: `AdminResultActionsModal` (`ChampionshipInProgress.tsx:1150`) não fecha
com `Escape` e deixa a página rolar por trás.

❌ **Quatro escalas de z-index concorrentes:** `z-50` (6×), `z-100`, `z-200` / `z-[200]` (3×),
`z-999` (6×). Um modal aberto sobre outro empilha por sorte.
→ Correção: adotar a do `StandardModal` (`z-999`) como única, via reuso do primitivo.

❌ **Zero dark mode.** Nenhum arquivo de campeonato tem uma única classe `dark:`, enquanto
`index.css:1650` declara `@media (prefers-color-scheme: dark)`. Em aparelho no escuro as telas
ficam brancas.

❌ **Token drift em código novo.** `TournamentBracketView.tsx:74` usa `bg-[#061320]/90`,
`text-slate-300`, `text-orange-300/50` — hex cru e a paleta `slate`, que não existe no
`@theme` do projeto (`index.css` define `stone` e `saibro`).

✅ `TournamentBracketView` acerta o essencial: estado de loading, estado vazio desenhado,
realtime com cleanup correto.
✅ `prefers-reduced-motion` está tratado globalmente em `index.css:187` e `:1662`.
✅ `creator/*` é o subconjunto com melhor acessibilidade — 14 atributos `aria-*`, contra
**zero** em `ChampionshipAdmin`, `ChampionshipInProgress` e `GroupDrawPage`.

---

## Parte 3 — Dívida técnica priorizada

`Prioridade = (Impacto + Risco) × (6 − Esforço)` — escalas 1-5.

| # | Item | Tipo | Imp. | Risco | Esf. | **Prio** |
|---|------|------|:--:|:--:|:--:|:--:|
| 1 | `confirm()` apaga confrontos com resultado, sem undo | UX/Dados | 3 | 5 | 1 | **40** |
| 2 | 52 `alert()` → `toast` (Toaster já montado) | UX | 4 | 3 | 2 | **28** |
| 3 | Apagar 1.712 linhas órfãs | Código | 3 | 2 | 1 | **25** |
| 4 | `setInterval` sem cleanup no Criador | Código | 2 | 3 | 1 | **25** |
| 5 | Fluxo morto da 4ª Classe (~150 linhas) | Código | 3 | 3 | 2 | **24** |
| 6 | Escrita não-transacional (grupos/rodadas+partidas) | Arquitetura | 3 | 5 | 3 | **24** |
| 7 | 3 implementações de classificação | Código | 4 | 4 | 3 | **24** |
| 8 | 126 textos < 12px → `text-xs` | UX/a11y | 3 | 3 | 2 | **24** |
| 9 | 39 `console.*` → `lib/logger.ts` | Código | 2 | 2 | 1 | **20** |
| 10 | Toggles de origem não persistidos entre sessões | UX | 2 | 2 | 1 | **20** |
| 11 | 13 modais à mão → `StandardModal` | UX/a11y | 3 | 3 | 3 | **18** |
| 12 | Mensagens de erro cruas do Postgres | UX | 3 | 2 | 2 | **20** |
| 13 | 83 `any` + lint permissivo | Tipos | 3 | 3 | 4 | **12** |
| 14 | Cobertura 0% nos 6 componentes-monstro | Testes | 5 | 5 | 5 | **10** |
| 15 | Unificar os 2 sistemas de grupos | Arquitetura | 4 | 4 | 5 | **8** |
| 16 | Dark mode nas telas de campeonato | UX | 2 | 1 | 4 | **6** |
| 17 | `DESIGN_SYSTEM.md` ≠ `index.css` | Docs | 2 | 1 | 1 | **15** |

### Plano em 4 fases (cabe ao lado de trabalho de feature)

**Fase 0 — Higiene (1 dia, risco ~zero)** — itens 3, 4, 5, 9, 17
`git rm` dos 4 órfãos, remoção do fluxo morto da 4ª Classe, cleanup dos intervalos,
`console.*` → `logger`, correção da paleta no `DESIGN_SYSTEM.md`.
Ganho: −1.860 linhas, −2 funções de complexidade 93 e 53 do relatório.

**Fase 1 — Não perder dado e não deixar o usuário no escuro (2-3 dias)** — itens 1, 2, 12, 10
Modal de confirmação tipada para "Limpar Confrontos"; substituição mecânica dos 52 `alert()`;
mapa de erros humanos; persistir `allowGuests`/`allowStudents`.
É a fase que mais muda a percepção de qualidade por hora investida.

**Fase 2 — Consistência visual (3-4 dias)** — itens 8, 11, 16
Varredura `text-[9|10|11]px` → `text-xs`; migração dos 13 modais para `StandardModal`
(resolve z-index, foco e `Escape` de uma vez); alvos de toque a 44px; `dark:` nas superfícies.

**Fase 3 — Estrutural, incremental (contínuo)** — itens 6, 7, 13, 14, 15
Regra do escoteiro: **toda regra de negócio que sair de um componente vai para
`lib/championship/` com teste**. Começar por `calculateStandings` (item 7), que já tem destino
pronto e testado. Só depois atacar a quebra dos componentes-monstro — nunca antes da rede existir.

---

## Fase 0 — executada ✅

Aplicada em passos pequenos, com `tsc`, `eslint`, suíte e build verdes entre cada um.

### Antes → depois

| Métrica | Antes | Depois | |
|---|:--:|:--:|:--:|
| Linhas no diff | — | **−1.958 / +122** | ⬇ |
| Arquivos-fonte | 139 | **135** | ⬇ |
| Funções com complexidade > 5 | 113 | **109** | ⬇ |
| Arquivos > 200 linhas | 49 | **46** | ⬇ |
| Funções > 20 linhas | 122 | **118** | ⬇ |
| `ChampionshipCreator` (complexidade) | 162 | **133** | ⬇ 18% |
| `ChampionshipInProgress` (complexidade) | 167 | **166** | ⬇ |
| Duplicação | 2,3% | **2,2%** | ⬇ |
| `console.*` no escopo | 39 | **0** | ⬇ |
| Cobertura (linhas) | 51,36% | **51,44%** | ⬆ |
| Cobertura (ramos) | 36,58% | **36,75%** | ⬆ |
| Testes | 266 | **270** | ⬆ |
| Ciclos de dependência | 0 | **0** | = |

### O que foi feito

1. **Órfãos removidos (−1.712 linhas):** `NewChampionship.tsx`, `AdminChampionshipDetail.tsx`,
   `AdminTournamentDetails.tsx`, `AdminTournaments.tsx`. Some do relatório de complexidade uma
   função de 93 e outra de 53.
2. **Fluxo morto da 4ª Classe removido (−158 linhas):** `runDrawPrimeiraFase`, `runDrawCabecas`,
   `remainingPool4`, `qualifyMatches`, `primeiraFaseMatches`, `displayPrimeira`, `displayCabecas`,
   os dois blocos de render inalcançáveis, o indicador de 3 passos que anunciava etapas que não
   existem, e os imports `drawClasse4PrimeiraFase` / `drawClasse4CabecasDeChave` /
   `buildClasse4Bracket`. `DrawSubStep4` reduzido a `'qualify' | 'done'`, que é o que o código
   realmente usa.
3. **Timers com cleanup:** `useEffect` de desmontagem limpando `anim5Ref` e `anim4Ref` no
   `ChampionshipCreator`.
4. **39 `console.*` → `logger`:** eventos nomeados (`championship_started`,
   `championship_start_failed`, `match_result_save_failed`, …) com contexto estruturado. Os 16
   `console.log` com emoji de `handleStartChampionship` viraram **um** `logger.info` no sucesso
   e **um** `logger.error` na falha.
5. **`errorMessage()` em `lib/logger.ts`:** os `catch` repetiam
   `error?.message ?? String(error)` em 6 lugares. Extraído com teste (4 casos novos), o que
   também desfez o aumento de complexidade que a primeira versão da migração tinha causado.
6. **`DESIGN_SYSTEM.md` corrigido:** a paleta `saibro-*` documentada (`#F26522` etc.) não era a
   implementada (`#ea580c` etc.). Sincronizada com o `@theme` do `index.css`, com nota de que
   o CSS é a fonte da verdade.
7. **`coverage/` no `.gitignore`.**

### Nada foi comitado

As mudanças estão no working tree para você revisar. Sugestão de branch antes de comitar:

```bash
git checkout -b chore/auditoria-campeonatos
```

### Uma decisão que deixei em aberto

Com o indicador de 3 passos fora, ficou visível um comportamento que **preservei de propósito**
para não misturar estrutura com comportamento: o bloco do sorteio da 4ª Classe é renderizado sob
`drawSubStep === 'qualify'`, e `runDrawQualify` termina em `'done'` — ou seja, **a lista de
confrontos sorteados desaparece no exato instante em que fica pronta**. Só sobra o botão "Salvar
Campeonato e Gerar Tabela". É um item de Fase 1 (`ChampionshipCreator.tsx:826`): remover o gate
`drawSubStep === 'qualify'` para o resultado permanecer na tela.

> Resolvido na Fase 1 — ver abaixo.

---

## Fase 1 — executada ✅

Fase de **comportamento**: aqui os testes mudam junto, ao contrário da Fase 0.

### Antes → depois

| Métrica | Fase 0 | Fase 1 | |
|---|:--:|:--:|:--:|
| Cobertura de linhas | 51,44% | **55,27%** | ⬆ |
| Cobertura de ramos | 36,75% | **38,08%** | ⬆ |
| Testes | 270 | **303** | ⬆ |
| `alert()` / `confirm()` nativos no escopo | 43 / 1 | **0 / 0** | ⬇ |
| `ChampionshipInProgress` CC | 166 | **166** | = |
| `ChampionshipCreator` CC | 133 | **132** | ⬇ |
| Duplicação | 2,2% | **2,2%** | = |
| Ciclos de dependência | 0 | **0** | = |

`tsc --noEmit` exit 0 · `vite build` ✓ · eslint: 1 warning pré-existente em arquivo não tocado.

### O que foi feito

**1. `lib/humanErrors.ts` (novo) — causa + correção, nunca culpa.**
Traduz códigos do Postgres (`23505`, `23503`, `23502`, `23514`, `42501`, `42P01`, `42703`) e do
PostgREST (`PGRST116`, `PGRST301`), além de detectar falha de rede pelo texto do runtime.
`'duplicate key value violates unique constraint'` virou *"Este registro já existe."* +
*"Verifique se o atleta ou confronto já não foi cadastrado antes."*
`CHAMPIONSHIP_ERRORS` guarda os erros de negócio que duas telas checam, para que o texto não
divirja entre elas. **16 testes.**

**2. `notify.failure(error, fallback, { event, ...ctx })` em `lib/notifications.ts`.**
Junta o que estava separado e sempre saía pela metade: **loga o erro cru** (suporte) e **mostra o
humano** (tela), numa chamada. `errorMessage()` continua sendo a versão fiel para log;
`humanizeError()` é a versão útil para a pessoa.

**3. `components/ui/ConfirmDialog.tsx` (novo) — confirmação tipada. 13 testes.**
Foco inicial, Esc, trap de Tab, foco devolvido a quem abriu, scroll do fundo travado,
alvos de 44px, `motion-reduce`. O modo `requireTyped` compara ignorando caixa e espaços — a
barreira é atenção, não datilografia — e **limpa o campo ao reabrir**, senão o botão voltaria
já destravado.

**4. "Limpar Confrontos" deixou de ser um `confirm()` nativo.**
`confirm()` é respondido no reflexo, e o custo do reflexo errado ali é a tabela inteira de um
campeonato em andamento. Agora o diálogo **mostra o tamanho do estrago antes do clique**
(`32 confrontos` / `12 placares já lançados`), exige digitar `APAGAR`, e o botão fica desabilitado
quando não há nada para apagar. As duas linhas aparecem mesmo zeradas: `0 placares já lançados`
informa que não há nada de valor em jogo — informação que a ausência da linha não daria.

**5. 43 `alert()` → toast, em 6 arquivos.**
`alert()` bloqueia a página, não diz o que fazer e some sem rastro. Cada um virou `notify.success`,
`notify.warning` ou `notify.failure` com evento de domínio nomeado
(`match_result_save_failed`, `championship_finish_failed`, `round_publish_failed`…).

**6. O sorteio da 4ª Classe não some mais** — e mais dois defeitos no mesmo bloco:
- o resultado sumia no instante em que ficava pronto (o gate `drawSubStep === 'qualify'` saiu);
- o título dizia **"Etapa 1 — Qualify"**, prometendo uma Etapa 2 que não existe desde a Fase 0;
- o texto dizia **"6 atletas ... Jogos 1, 2 e 3"** enquanto o código sorteia 20 atletas e exibe
  os Jogos 1 a 4. Era informação falsa na tela.

Com o gate fora, `drawSubStep` virou estado que ninguém lê — removido junto com o tipo
`DrawSubStep4`.

**7. Os toggles "Aceitar convidados/alunos" pararam de mentir.**
Reabrir o Criador mostrava os toggles desligados **com convidados já na lista** — a tela negando o
que os próprios dados afirmam — e, sem a aba "Convidado", o admin não conseguia inscrever o
próximo. Agora as inscrições existentes ligam o toggle. Só liga, nunca desliga: desligar apagaria
a escolha feita antes da primeira inscrição chegar.

> Persistência completa (o admin liga o toggle, sai antes de inscrever alguém, volta e encontra
> ligado) exigiria colunas `allow_guests` / `allow_students` em `championships` — **migração no
> banco remoto, que não fiz sem você pedir**. A correção acima resolve o caso que causa dano; sobra
> só o caso inofensivo de re-clicar um toggle.

**8. `plural()` em `utils.ts`** — tira o ternário de concordância de dentro do JSX. 4 testes.

### Uma regressão minha, encontrada e corrigida

A primeira versão do diálogo subiu `ChampionshipInProgress` de **166 → 172**: eu tinha escrito
cinco ternários de plural inline (`confronto${n === 1 ? '' : 's'}`), e cada um vira dois ramos que
ninguém testa. Extraí `plural()` e reescrevi a lista de consequências sem o spread condicional —
voltou a 166, e a mensagem ficou melhor.

O mesmo vale para a cobertura: cada peça nova (`humanErrors`, `ConfirmDialog`, `plural`) entrou
com teste, e por isso a cobertura **subiu** 3,8 pontos em vez de cair.

### O que ficou de fora, de propósito

> Os três itens foram resolvidos depois, junto com a Fase 2 — ver abaixo.

- **`confirm()` fora do "Limpar Confrontos"** — restam nativos em ações de menor custo
  (remover inscrição, W.O., cancelar partida). O `ConfirmDialog` já está pronto para elas; é
  troca mecânica, mas não estava no escopo da Fase 1.
- **Migração `allow_guests` / `allow_students`** — mexe no banco remoto.
- **Os outros 70 `alert()` do app** (Agenda, AdminPanel, Klanches…) — fora do escopo de
  campeonatos.

---

## Pendências da Fase 1 — resolvidas ✅

### 1. `useConfirm()` — o `confirm()` nativo sem o custo de um modal controlado

O `confirm()` nativo sobrevive nos cantos de qualquer app por um motivo prático: ele é **uma
linha dentro do handler**. Um `<ConfirmDialog>` controlado por estado cobra, em cada uso, um
`useState`, um handler partido em duas metades e um bloco de JSX. Por isso a Fase 1 trocou um
`confirm()` e deixou os outros 23.

[`hooks/useConfirm.ts`](hooks/useConfirm.ts) + [`components/ui/ConfirmProvider.tsx`](components/ui/ConfirmProvider.tsx)
devolvem o custo de uma linha:

```tsx
if (!await confirm({ title: 'Remover inscrição?', confirmLabel: 'Remover' })) return;
```

Um único `<ConfirmDialog>` montado na raiz, uma promise por pergunta. **Os 23 `confirm()` e o
`prompt()`+`alert()`+`confirm()` do reset de ranking viraram 0** — em campeonatos, agenda,
alunos, financeiro, Klanches, painel admin e professores.

Cada diálogo ganhou o que o nativo não dá: o que exatamente se perde antes do clique, tom
(`danger`/`warning`), confirmação digitada quando o custo justifica, e foco preso.

**Dois defeitos apareceram ao migrar:**

- **`ConfirmDialog` atrás do modal.** Quase toda confirmação nasce de um botão que já está
  dentro de um modal — e o `StandardModal` usa `z-999`. Renderizado na árvore com `z-100`, o
  diálogo ficava **atrás**: o admin clicava em "W.O." e a tela parecia travada. Corrigido com
  portal para o `body` e `z-1000`, com teste.
- **Escape fechando dois modais.** O `StandardModal` escuta `keydown` no `window`; um Escape
  sobre o diálogo fechava também o modal de trás. Agora o diálogo captura o Escape na fase de
  captura do `document` e interrompe a propagação — só o topo responde.

- **`FinanceiroAdmin`**: a pergunta dizia "isentar este Day Use?" mesmo quando a ação era
  desfazer a isenção. Quem estava cobrando de novo lia o contrário do que ia fazer.

### 2. `allow_guests` / `allow_students` no banco

[`supabase/migrations/20260808120000_championship_participant_sources.sql`](supabase/migrations/20260808120000_championship_participant_sources.sql)
— duas colunas booleanas em `championships`, com backfill pela evidência: quem já tem convidado
inscrito aceitou convidado.

[`lib/championship/participantSources.ts`](lib/championship/participantSources.ts) (12 testes,
100% de cobertura) lê e grava, **tolerante à migration ainda não aplicada**: em `42703`/`PGRST204`
degrada exatamente para o comportamento anterior — deduzir pelas inscrições — em vez de derrubar
a tela. Erro que não seja coluna faltando (RLS, por exemplo) continua propagando.

> ⚠️ **A migration não foi aplicada.** O MCP do Supabase autenticado nesta sessão só alcança
> outros dois projetos; o `smztsayzldjmkzmufqcz` do `.env` não está entre eles. O arquivo está
> pronto e o app funciona sem ele — mas os toggles só persistem de verdade depois de aplicá-lo.

### 3. Os outros 71 `alert()`

Zero `alert()` no app inteiro. Cada um virou `notify.success`, `notify.warning` ou
`notify.failure` — este último logando o erro cru com evento de domínio nomeado e mostrando o
humano. Os `console.error` que os acompanhavam saíram junto.

Dois ganhos além da troca mecânica:

- **`lib/students/validateStudentForm.ts`** (10 testes) — `AdminStudents` e `ProfessorProfile`
  mantinham a mesma sequência de `if`s com as mesmas mensagens, e **já tinham divergido**: só a
  do admin cobrava professor responsável. Regra duplicada é regra que envelhece em ritmos
  diferentes.
- **`CreatorRegistration.remover()`** tinha `try/finally` sem `catch`: um delete barrado pela RLS
  voltava com o nome ainda na lista e nenhuma mensagem — a tela dizia "não removi" sem dizer isso
  em lugar nenhum.

Saiu também o `notify.confirm()` e o `withNotification()` de `lib/notifications.ts`: código morto
que competia com o `ConfirmDialog` por um mesmo trabalho.

---

## Fase 2 — executada ✅

### Antes → depois

| Métrica | Fase 1 | Fase 2 | |
|---|:--:|:--:|:--:|
| Cobertura de linhas | 55,27% | **56,60%** | ⬆ |
| Cobertura de ramos | 38,08% | **39,36%** | ⬆ |
| Testes | 303 | **349** | ⬆ |
| `alert()` no app | 71 | **0** | ⬇ |
| `confirm()` / `prompt()` nativos no app | 23 / 2 | **0 / 1** | ⬇ |
| Textos abaixo de 12px no módulo | 119 | **0** | ⬇ |
| Modais à mão no módulo | 10 | **1** | ⬇ |
| `ChampionshipInProgress` CC | 166 | **162** | ⬇ |
| `ChampionshipAdmin` CC | 131 | **131** | = |
| Duplicação | 2,2% | **2,2%** | = |
| Ciclos de dependência | 0 | **0** | = |

`tsc --noEmit` exit 0 · `vite build` ✓ · eslint: 1 warning pré-existente em arquivo não tocado.

### O que foi feito

**1. 119 textos abaixo de 12px → `text-xs`.** Quase todos eram rótulos `uppercase
tracking-widest` a 9 ou 10px — a combinação que mais custa legibilidade. Verificado no navegador
a 375px: as abas continuam cabendo sem truncar, e os chips de restrição quebram para a segunda
linha, que o `flex-wrap` já previa.

**2. 9 dos 10 modais à mão migrados** para `StandardModal` ou `useConfirm`. O ganho não é
cosmético: eles usavam `z-50`, `z-100`, `z-200` e `z-999` para papéis equivalentes, e nenhum
fechava com Escape nem travava o scroll do fundo.

Três deles eram **confirmações desenhadas à mão** — "Cancelar edição?", "Tem certeza?" (iniciar
campeonato) — e viraram uma linha de `useConfirm`, levando junto dois `useState` e ~60 linhas de
JSX.

Ficou de fora, de propósito, o overlay de animação do sorteio em `GroupDrawPage`: é um efeito
transitório sem botão de fechar, não um diálogo. Migrá-lo daria a ele um Escape que não fecha
nada.

**3. `StandardModal` ganhou o que faltava** (e com isso ~20 modais do app, não só os de
campeonato): foco levado para dentro ao abrir e devolvido a quem abriu ao fechar,
`motion-reduce:animate-none`, `aria-label`, e uma prop `padding` para os bottom sheets. Cobertura
de 9,52% → **82,14%**, com 11 testes.

**4. Alvos de toque a 44px** (`.hit-44` em `index.css`) nos 9 botões-ícone do módulo que estavam
abaixo disso. O pior caso era a lista de inscritos do Criador: estrela e lixeira eram ícones de
16px sem padding nenhum, lado a lado — errar a estrela removia a inscrição.

**5. Movimento reduzido, no app inteiro.** São mais de 250 usos de `animate-*` e `transition-*`
espalhados; depender de cada autor lembrar do `motion-reduce:` é depender de ninguém esquecer.
A regra virou global em `index.css`, com uma exceção deliberada: **o spinner continua girando**,
mais devagar. Parado, ele diz "travou" — o oposto do que existe para dizer.

**6. Duplicação retirada de dois pontos:**
`Championships.tsx` repetia a mesma string de 200 caracteres nas seis abas (`tabClass()` agora);
e `deleteChampionshipMatches` saiu de dentro de `ChampionshipInProgress` para
[`lib/championship/matches.ts`](lib/championship/matches.ts) com 3 testes — a escolha entre
apagar por rodada ou por campeonato falha em silêncio das duas formas, e agora mora onde é
testada.

### Dark mode — não feito, e por quê

O app **não tem dark mode**: zero `dark:` em 138 componentes, nenhum toggle, nenhuma classe
`dark` no `<html>`. O único CSS de tema escuro ajusta a opacidade de uma animação decorativa.

Aplicar `dark:` só no módulo de campeonatos entregaria, num celular em modo escuro, uma tela de
campeonato escura dentro de um app claro — Agenda, Ranking, Perfil e Dashboard continuariam
brancos. Isso é pior do que claro em tudo.

Dark mode é decisão de app inteiro, não de módulo: precisa de tokens de superfície no `@theme`,
um toggle com persistência e uma varredura pelos 138 componentes. Era o item de **menor
prioridade da auditoria (6)** e continua na fila, agora com escopo honesto.

---

## Fase 3 — em andamento

### Migration aplicada ✅

`20260808120000_championship_participant_sources` está no banco e registrada em
`supabase_migrations.schema_migrations`. Backfill conferido contra as inscrições: dos 4
campeonatos, os 3 que têm convidado inscrito ficaram com `allow_guests = true`; o que não tem,
`false`. O cache do PostgREST foi recarregado e as colunas já respondem pelo caminho exato que o
app usa.

### Item 7 — classificação: era menos do que a auditoria dizia, e pior

`calculateGroupStandings` já era única, em `championshipStandings.ts`, usada por 5 telas. O que
sobrava em `Championships.tsx` era uma `calculateStandings()` de 55 linhas com regra de desempate
própria, cujo único consumidor era:

```tsx
const _standings = calculateStandings();   // nunca lido
```

Rodava a cada render de um componente de 2.667 linhas, e o resultado ia para o lixo. **60 linhas
removidas**, nada mais a unificar.

### Item 6 — a escrita que deixava o campeonato pela metade

`GroupDrawEditor.salvar()` faz três inserts em três tabelas, e o PostgREST não abre transação
entre eles. Dos três pontos de falha, só um corrompia — e corrompia de forma permanente:

1. `championship_groups` grava, `championship_group_members` falha → grupos sem nenhum membro.
2. O usuário vê o erro e clica de novo.
3. `saveGroups` via os grupos órfãos, concluía **"já está feito"** e devolvia sucesso sem gravar
   membro nenhum.

A classe ficava presa em grupos vazios, e repetir a ação não consertava — o caminho de
recuperação escondia a corrupção em vez de desfazê-la.

**A correção não é uma transação, é convergência.** Cada passo pergunta o que já existe e grava
só o que falta, então repetir termina o serviço de onde ele parou. O insert de `matches` é uma
única instrução (atômica no Postgres) e já tinha guarda contra duplicação, e o índice único
`(group_id, registration_id)` que já existia no banco é a rede embaixo de tudo.

Antes disso, **15 testes de caracterização** em [`championshipGroupWrites.test.ts`](__tests__/championshipGroupWrites.test.ts)
travaram o comportamento — os dois que documentavam o defeito viraram os dois que provam a
convergência. `groupPersistence.ts` saiu de **42,85% para 100%** de cobertura de linhas.

Verifiquei no banco que não há grupo órfão nem membro duplicado hoje: nenhum reparo de dado é
necessário.

### Antes → depois

| Métrica | Fase 2 | Fase 3 | |
|---|:--:|:--:|:--:|
| Cobertura de linhas | 56,60% | **57,81%** | ⬆ |
| Cobertura de ramos | 39,36% | **40,29%** | ⬆ |
| Testes | 349 | **364** | ⬆ |
| `groupPersistence.ts` | 42,85% | **100%** | ⬆ |
| Funções acima de CC 5 | 110 | **109** | ⬇ |

### Performance — 68% do carregamento inicial era desperdício

Antes de escrever a rede de teste dos componentes-monstro, medi o bundle. O achado não estava em
nenhum componente: estava no `manualChunks` do `vite.config.ts`.

**Linha de base (medida com `vite build`, o mesmo comando antes e depois):**

| Carga inicial | raw | gzip |
|---|--:|--:|
| `index.js` | 441,68 kB | 108,75 kB |
| `ui-vendor` (lucide + recharts) | 421,74 kB | 122,69 kB |
| **`three-vendor`** | **1.064,79 kB** | **295,25 kB** |
| `utils-vendor` (jspdf + html2canvas) | 594,21 kB | 177,10 kB |
| `supabase-vendor` | 173,26 kB | 45,69 kB |
| `index.css` | 190,12 kB | 25,32 kB |
| **Total** | **2.885,80 kB** | **774,80 kB** |

**Três causas, cada uma corrigida e medida em separado:**

**1. O React morava dentro do Three.js.** O `react-vendor` tinha **1 byte**. A forma de objeto do
`manualChunks` casa por substring, e `@react-three/fiber` contém `react` — então o React foi
absorvido pelo `three-vendor`, e o entry o importava de lá:

```
import{j as e,R as In}from"./three-vendor-DPesCo…"
```

Resultado: **todo sócio baixava 1 MB de Three.js para abrir a Agenda**, num app onde o jogo 3D é
uma aba que quase ninguém abre. Trocado pela forma de função, que casa por caminho exato.
**−236,81 kB gzip.**

**2. Um helper de 300 bytes arrastava 777 kB.** Corrigido o item 1, o `export-vendor` continuava
no `modulepreload`. Instrumentei o build em vez de supor: os módulos virtuais
`\0vite/preload-helper.js` e `\0commonjsHelpers.js` não têm `node_modules` no id, caíam no
`return` sem destino, e o Rollup os colocava dentro do `export-vendor` — que assim virava
dependência estática do entry. Ganharam destino explícito.

**3. `jspdf` e `html2canvas` importados no topo.** São ~239 kB comprimidos para uma ação que só
o admin executa, e só ao clicar em "Exportar". Viraram `import()` dinâmico via
[`lib/exportTools.ts`](lib/exportTools.ts). O mesmo para o `recharts`, que só o Dashboard usa:
o Dashboard virou `lazy()`, como as outras 9 telas já eram.

De quebra, `date-fns` estava listado no `manualChunks` sem ser importado em lugar nenhum.

**Depois:**

| Carga inicial | raw | gzip |
|---|--:|--:|
| `index.js` | 430,53 kB | 105,88 kB |
| `react-vendor` | 196,35 kB | 61,58 kB |
| `supabase-vendor` | 173,26 kB | 45,69 kB |
| `icons-vendor` | 42,57 kB | 9,24 kB |
| `index.css` | 190,12 kB | 25,32 kB |
| **Total** | **1.032,83 kB** | **247,71 kB** |

**−1.852,97 kB raw · −527,09 kB gzip · −68,0%**

Verificado no navegador contra o build de produção, não só no relatório do bundler: **241,9 kB
transferidos** em 5 arquivos, zero erro no console, tela renderizando. E a prova de que o
carregamento sob demanda funciona, medida na própria página:

```json
{"carregado_no_load_inicial": false, "carregado_sob_demanda_agora": true,
 "kb": 233.2, "simbolos_exportados": 2}
```

Nada disso mudou comportamento: 364 testes verdes, `tsc` exit 0, mesma warning pré-existente.

> `lib/pdfExportPremium.ts` (190 linhas) não é importado por ninguém — código morto encontrado
> ao mapear os importadores. Não apaguei; fica registrado.

### Item 14 — a rede do `ChampionshipInProgress`, e o que ela revelou sobre a régua

19 testes de caracterização em
[`championshipInProgress.test.tsx`](__tests__/championshipInProgress.test.tsx), no mesmo formato
que o repo já usava para a Agenda: Supabase mockado por tabela, componente renderizado de
verdade. Travam o estado vazio ("Pronto para Iniciar!"), a abertura na **rodada ativa** e não na
primeira, a navegação entre rodadas com os extremos travados, as abas (e a ausência de
CLASSIFICAÇÃO no Resenha Open), o aviso de rodada em rascunho só para admin, o painel de
gerenciamento só para admin, o fluxo completo de "Limpar Confrontos" — contagens, palavra
digitada, e o filtro exato do `delete` — e a ordenação das classes por número (4ª, 5ª, 10ª) em
vez de alfabeto.

**Um defeito de acessibilidade apareceu ao escrever o teste:** as setas de navegação de rodada
eram botões só com ícone, sem nome acessível. Não dava para alcançá-las por papel nem por nome —
nem no teste, nem num leitor de tela. Ganharam `aria-label` e alvo de 44px. Quando um teste é
difícil de escrever, em geral o código está dizendo alguma coisa.

#### A cobertura "caiu" 12 pontos — e isso era o instrumento, não o trabalho

Depois dos 19 testes, o relatório mostrou **57,81% → 45,10%**. Pela regra do modo IMPROVE, queda
de cobertura é regressão e o passo deveria ser revertido. Apurei antes de aceitar:

| | Antes | Depois | Δ |
|---|--:|--:|--:|
| **Linhas cobertas (absoluto)** | 1.543 | **1.755** | **+212** |
| **Ramos cobertos (absoluto)** | 1.159 | **1.310** | **+151** |
| Arquivos no relatório | 41 | 55 | +14 |
| % de linhas | 57,81% | 45,10% | −12,71 pp |

Renderizar o componente puxou 14 arquivos que **nunca tinham sido instrumentados** —
`Championships.tsx` a 2,41%, `BracketView`, `MatchScheduleModal`, `TournamentBracketView`… — para
dentro do denominador. Mais código real ficou coberto; o percentual caiu porque o relatório
finalmente enxergou uma superfície maior.

A causa é o padrão do v8: por omissão ele só instrumenta o que algum teste importa. Isso torna o
percentual **incomparável entre execuções** — ele sobe quando você testa, e desce quando você
testa algo que importa muita coisa nova. Como régua de regressão, não serve.

`vitest.config.ts` passou a declarar `coverage.include` sobre `components/`, `lib/`, `hooks/`,
`contexts/`, `utils.ts` e `App.tsx`. A base honesta:

| | Valor |
|---|--:|
| Linhas | **1.755 / 9.394 — 18,68%** |
| Ramos | **1.310 / 8.905 — 14,71%** |
| Arquivos medidos | 126 |

> ⚠️ **Todos os percentuais de cobertura das fases anteriores neste documento foram medidos com
> o denominador móvel** e não são comparáveis a este. Os números absolutos (linhas e ramos
> cobertos) continuam válidos e sempre subiram.

Com a régua consertada, a matriz de risco mudou de dono — e apontou um arquivo que estava
invisível:

| Arquivo | Complexidade máx. | Cobertura |
|---|:--:|:--:|
| `components/AdminPanel.tsx` | **184** | 0% |
| `components/ChampionshipCreator.tsx` | 132 | 0% |
| `components/ChampionshipAdmin.tsx` | 131 | 0% |
| `components/ChampionshipInProgress.tsx` | 162 | **41,23%** |

O `AdminPanel` é mais complexo que qualquer componente de campeonato e nunca apareceu nos
relatórios anteriores, porque nenhum teste o importava.

### Item 14, continuação — `ChampionshipAdmin` e a última warning

**16 testes** em [`championshipAdmin.test.tsx`](__tests__/championshipAdmin.test.tsx). O alvo foi
o que ninguém ousaria tocar sem rede:

- **O fallback de coluna.** `fetchChampionshipRows` refaz o `SELECT` até 16 vezes, descartando a
  cada volta a coluna que o banco disse não existir — uma defesa contra ambientes onde alguma
  migration não rodou. Três testes travam isso: descarta uma coluna e volta a funcionar, descarta
  várias em sequência, e **desiste na primeira tentativa** quando o erro é outro (RLS, por
  exemplo) em vez de girar 16 vezes.
- **Os diálogos que mexem em ranking de gente real.** Encerrar campeonato só chama
  `finish_championship` depois do aceite; cancelar edição é `danger` e diz que a edição anterior
  volta a valer; remover inscrição nomeia quem sai na pergunta e apaga o id certo.
- Sócio aparece pelo nome do perfil, convidado pelo nome digitado; "Finalizar" some em campeonato
  encerrado; "Cancelar Edição" some fora de uma série; seleção de rodadas em lote com a contagem
  concordando.

**A última warning do eslint foi embora.** `ResenhaOpenTournamentBoard` tinha um `useEffect` sem
`centerPhase` nas dependências. Adicioná-la sem mais nada faria o quadro rolar a cada render, já
que a função nascia nova toda vez — então ela virou `useCallback([layout, zoom])`, e o efeito
passou a depender dela. **`npx eslint .` agora sai limpo.**

| | Antes | Depois |
|---|--:|--:|
| Testes | 383 | **399** |
| Linhas cobertas | 1.755 / 9.394 (18,68%) | **1.920 / 9.394 (20,43%)** |
| Ramos cobertos | 1.310 / 8.905 (14,71%) | **1.426 / 8.905 (16,01%)** |
| `ChampionshipAdmin` | 0% | **55,78%** |
| Warnings do eslint | 1 | **0** |

A matriz de risco não tem mais nenhum componente de campeonato no topo — o que sobrou é fora do
escopo desta auditoria:

| Arquivo | Complexidade máx. | Cobertura |
|---|:--:|:--:|
| `components/AdminPanel.tsx` | **184** | 0% |
| `components/ChampionshipCreator.tsx` | 132 | 0% |
| `components/AdminStudents.tsx` | 123 | 0% |
| `components/ProfessorProfile.tsx` | 112 | 0% |

### O que falta na Fase 3

- **Item 14 — cobertura dos componentes-monstro.** Dentro do escopo, resta o
  `ChampionshipCreator` (CC 132, 0%). Fora dele, `AdminPanel` (CC 184) é hoje o arquivo mais
  perigoso do repositório e nunca apareceu em relatório nenhum.
- **Item 15 — unificar os dois sistemas de grupos** (`groupKnockout.ts` e
  `championship/knockoutFromGroups.ts`).
- **Item 13 — 83 `any` e lint permissivo** (`@typescript-eslint/no-explicit-any` está `off`).
- **Dark mode**, com o escopo honesto descrito na Fase 2.

---

## O que verifiquei e estava errado

Antes do pull, o achado nº 1 era **"a aba Chaveamento renderiza vazio para todo campeonato
mata-mata do Criador"** — `Championships.tsx` filtrava `m.phase === 'Oitavas'` enquanto
`saveGenericBracket` nunca grava `matches.phase`. Os commits `2a537f7` e `5f39ab0` corrigiram
isso: a chave agora sai das rodadas via `round_id`, com a lista fixa antiga preservada só como
fallback para campeonatos legados. **O achado não vale mais** — sobra apenas o código morto do
avanço no cliente (achado #8) e o fato de que, se os dois caminhos falharem, o fallback devolve
um `<div>` vazio sem estado vazio desenhado.
