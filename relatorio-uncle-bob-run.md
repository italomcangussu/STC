# Auditoria Uncle Bob — STC

> Gerado por `audit_codebase.py`. Limiares em `references/metrics-thresholds.md`. Interprete cada número com a razão de engenharia (heurísticas em `references/`), não como dogma.

## Saúde por eixo

| Eixo | Status | Resumo |
|------|:------:|--------|
| Cobertura de testes | · | **não medido** — rode com `--run` ou gere coverage |
| Teste de mutação | · | **não medido** — configure Stryker (JS) ou mutmut (Py) |
| Estrutura de dependências | 🔴 | 1 ciclo(s) de dependência; 100 arquivos com imports internos |
| Complexidade ciclomática | 🔴 | 105/405 funções acima de 5 |
| Tamanho de módulos/funções | 🔴 | 45 arquivos > 200 linhas; 114 funções > 20 linhas |
| Duplicação | 🟢 | ~2.4% de blocos repetidos (heurístico) |

_Escopo: 118 arquivos-fonte, 405 funções analisadas._

## 🔴 Ciclos de dependência (viola ADP — prioridade ALTA)

Ciclos impedem evoluir/testar/deployar componentes isoladamente. Quebre invertendo uma seta via DIP (interface no lado estável) ou extraindo um módulo comum. Ver `references/clean-architecture.md`.

1. ciclo entre 2 módulos:
   - `lib/resenhaOpenService.ts`
   - `lib/resenhaOpenOfficialBracket.ts`

## Funções mais complexas (complexidade > 5)

| Severidade | Função | Local | Complex. | Linhas | Args | Aninh. |
|:--:|--------|-------|:--:|:--:|:--:|:--:|
| 🔴 | `Agenda` | `components/Agenda.tsx:1208` | **222** | 1080 | 1 | 7 |
| 🔴 | `NewChallengeModal` | `components/AdminPanel.tsx:48` | **189** | 1636 | 1 | 4 |
| 🔴 | `ChampionshipInProgress` | `components/ChampionshipInProgress.tsx:38` | **167** | 1202 | 1 | 4 |
| 🔴 | `getAvailableTimes` | `components/Agenda.tsx:2290` | **130** | 558 | 3 | 0 |
| 🔴 | `AdminStudents` | `components/AdminStudents.tsx:25` | **127** | 804 | 0 | 6 |
| 🔴 | `GroupDrawPage` | `components/GroupDrawPage.tsx:56` | **124** | 1243 | 1 | 1 |
| 🔴 | `AdminResenhaOpen` | `components/AdminResenhaOpen.tsx:36` | **122** | 880 | 0 | 7 |
| 🔴 | `ProfessorProfile` | `components/ProfessorProfile.tsx:142` | **115** | 804 | 1 | 5 |
| 🔴 | `ChampionshipAdmin` | `components/ChampionshipAdmin.tsx:127` | **106** | 789 | 1 | 7 |
| 🔴 | `NewChampionship` | `components/NewChampionship.tsx:15` | **93** | 729 | 1 | 8 |
| 🔴 | `Klanches` | `components/Klanches.tsx:36` | **85** | 785 | 1 | 3 |
| 🔴 | `LiveScoreboard` | `components/LiveScoreboard.tsx:40` | **81** | 288 | 1 | 1 |
| 🔴 | `SuperSet` | `components/SuperSet.tsx:11` | **78** | 564 | 0 | 4 |
| 🔴 | `AthleteProfile` | `components/Athletes.tsx:44` | **76** | 569 | 1 | 5 |
| 🔴 | `ChallengesView` | `components/Challenges.tsx:488` | **74** | 510 | 1 | 8 |
| 🔴 | `AuthProvider` | `contexts/AuthContext.tsx:47` | **73** | 426 | 1 | 5 |
| 🔴 | `Championships` | `components/Championships.tsx:48` | **56** | 364 | 1 | 4 |
| 🔴 | `AdminChampionshipDetail` | `components/AdminChampionshipDetail.tsx:21` | **53** | 477 | 1 | 5 |
| 🔴 | `AdminMatchCreator` | `components/AdminMatchCreator.tsx:17` | **52** | 401 | 1 | 3 |
| 🔴 | `Dashboard` | `components/Dashboard.tsx:19` | **50** | 393 | 0 | 5 |

> Complexidade > 10 ⇒ nº de caminhos a testar explode. Extraia funções, use guard clauses (G18/G28) ou polimorfismo (G23/OCP).

## Funções mais longas (> 20 linhas)

| Severidade | Função | Local | Linhas | Complex. | Args |
|:--:|--------|-------|:--:|:--:|:--:|
| 🔴 | `NewChallengeModal` | `components/AdminPanel.tsx:48` | **1636** | 189 | 1 |
| 🔴 | `GroupDrawPage` | `components/GroupDrawPage.tsx:56` | **1243** | 124 | 1 |
| 🔴 | `ChampionshipInProgress` | `components/ChampionshipInProgress.tsx:38` | **1202** | 167 | 1 |
| 🔴 | `Agenda` | `components/Agenda.tsx:1208` | **1080** | 222 | 1 |
| 🔴 | `AdminResenhaOpen` | `components/AdminResenhaOpen.tsx:36` | **880** | 122 | 0 |
| 🔴 | `AdminStudents` | `components/AdminStudents.tsx:25` | **804** | 127 | 0 |
| 🔴 | `ProfessorProfile` | `components/ProfessorProfile.tsx:142` | **804** | 115 | 1 |
| 🔴 | `ChampionshipAdmin` | `components/ChampionshipAdmin.tsx:127` | **789** | 106 | 1 |
| 🔴 | `Klanches` | `components/Klanches.tsx:36` | **785** | 85 | 1 |
| 🔴 | `NewChampionship` | `components/NewChampionship.tsx:15` | **729** | 93 | 1 |
| 🔴 | `AthleteProfile` | `components/Athletes.tsx:44` | **569** | 76 | 1 |
| 🔴 | `SuperSet` | `components/SuperSet.tsx:11` | **564** | 78 | 0 |
| 🔴 | `getAvailableTimes` | `components/Agenda.tsx:2290` | **558** | 130 | 3 |
| 🔴 | `ChallengesView` | `components/Challenges.tsx:488` | **510** | 74 | 1 |
| 🔴 | `AdminChampionshipDetail` | `components/AdminChampionshipDetail.tsx:21` | **477** | 53 | 1 |
| 🔴 | `FinanceiroAdmin` | `components/FinanceiroAdmin.tsx:38` | **472** | 47 | 0 |
| 🔴 | `AuthProvider` | `contexts/AuthContext.tsx:47` | **426** | 73 | 1 |
| 🔴 | `AdminMatchCreator` | `components/AdminMatchCreator.tsx:17` | **401** | 52 | 1 |
| 🔴 | `Dashboard` | `components/Dashboard.tsx:19` | **393** | 50 | 0 |
| 🔴 | `Championships` | `components/Championships.tsx:48` | **364** | 56 | 1 |

> Função faz UMA coisa, em UM nível de abstração (Código Limpo cap. 3).

## Funções com excesso de argumentos (> 3)

- 🔴 `saveBracket` (`lib/resenhaOpenService.ts:271`) — **7 args**. Considere objeto-parâmetro ou quebrar a função (F1).
- 🔴 `attachPostgresChanges` (`hooks/useRealtimeSubscription.ts:25`) — **5 args**. Considere objeto-parâmetro ou quebrar a função (F1).
- 🔴 `checkOverlap` (`components/AdminPanel.tsx:36`) — **4 args**. Considere objeto-parâmetro ou quebrar a função (F1).
- 🔴 `checkOverlap` (`components/Agenda.tsx:77`) — **4 args**. Considere objeto-parâmetro ou quebrar a função (F1).
- 🔴 `onFinishMatch` (`components/Agenda.tsx:359`) — **4 args**. Considere objeto-parâmetro ou quebrar a função (F1).
- 🔴 `createMatch` (`lib/championshipUtils.ts:90`) — **4 args**. Considere objeto-parâmetro ou quebrar a função (F1).
- 🔴 `applyWalkover` (`lib/resenhaOpenAdvance.ts:45`) — **4 args**. Considere objeto-parâmetro ou quebrar a função (F1).
- 🔴 `replaceAthleteInMatch` (`lib/resenhaOpenAdvance.ts:75`) — **4 args**. Considere objeto-parâmetro ou quebrar a função (F1).

## Arquivos mais longos (> 200 linhas)

| Severidade | Arquivo | Linhas de código | I (instab.) |
|:--:|---------|:--:|:--:|
| 🔴 | `components/Agenda.tsx` | **2439** | 0.78 |
| 🔴 | `components/Championships.tsx` | **2204** | 0.81 |
| 🔴 | `components/AdminPanel.tsx` | **1471** | 0.94 |
| 🔴 | `components/GroupDrawPage.tsx` | **1110** | 0.75 |
| 🔴 | `components/ChampionshipInProgress.tsx` | **1078** | 0.93 |
| 🔴 | `components/AdminResenhaOpen.tsx` | **923** | 0.75 |
| 🔴 | `components/Challenges.tsx` | **847** | 0.86 |
| 🔴 | `components/ProfessorProfile.tsx` | **832** | 0.80 |
| 🔴 | `components/ChampionshipAdmin.tsx` | **811** | 0.71 |
| 🔴 | `components/AdminStudents.tsx` | **756** | 0.67 |
| 🔴 | `components/Klanches.tsx` | **729** | 0.75 |
| 🔴 | `components/NewChampionship.tsx` | **677** | 1.00 |
| 🔴 | `components/Athletes.tsx` | **670** | 0.83 |
| 🔴 | `components/SuperSet.tsx` | **489** | 0.60 |
| 🔴 | `lib/rankingService.ts` | **469** | 0.25 |
| 🔴 | `components/FinanceiroAdmin.tsx` | **451** | 0.60 |
| 🔴 | `components/AdminChampionshipDetail.tsx` | **438** | 1.00 |
| 🔴 | `lib/resenhaOpenService.ts` | **404** | 0.33 |
| 🟡 | `contexts/AuthContext.tsx` | **397** | 0.43 |
| 🟡 | `components/ResenhaOpenTournamentBoard.tsx` | **363** | 0.60 |

## Módulos muito dependidos (cuidado ao mudar)

| Arquivo | Ca (fan-in) | Ce (fan-out) | I |
|---------|:--:|:--:|:--:|
| `types.ts` | **52** | 0 | 0.00 |
| `lib/supabase.ts` | **45** | 0 | 0.00 |
| `utils.ts` | **22** | 1 | 0.04 |
| `components/TenisProPlayer/constants.ts` | **11** | 0 | 0.00 |
| `components/StandardModal.tsx` | **10** | 0 | 0.00 |
| `lib/logger.ts` | **9** | 0 | 0.00 |
| `lib/resenhaOpenService.ts` | **8** | 4 | 0.33 |
| `lib/rankingService.ts` | **6** | 2 | 0.25 |
| `lib/championshipUtils.ts` | **5** | 2 | 0.29 |
| `lib/groupKnockout.ts` | **5** | 2 | 0.29 |

> Ca alto + I baixo = muitos dependem dele e ele é concreto. Mudanças se propagam; proteja com testes fortes e considere extrair uma abstração estável (DIP). Ver Zona da Dor em `clean-architecture.md`.

---
_Próximo passo sugerido: começar pelos 🔴 (ciclos e lacunas de teste), criar rede de caracterização onde falta cobertura e refatorar em passos pequenos mantendo a suíte verde. Ver modo IMPROVE no SKILL.md._