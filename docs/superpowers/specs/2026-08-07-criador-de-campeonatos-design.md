# Criador de Campeonatos — Design

Data: 2026-08-07
Status: aprovado para planejamento

## Problema

Não existe como criar um campeonato pela interface, exceto pelo caminho do Sorteador Resenha Open, que é travado na série `resenha-open`, formato `mata-mata` e classes 4ª/5ª. O `ChampionshipAdmin` só gerencia campeonatos que já existem — não tem botão de criar. Dois wizards órfãos (`NewChampionship.tsx`, `AdminTournaments.tsx`) nunca foram ligados a rota nenhuma.

Além disso, `createResenhaOpenRounds` é **o único lugar do app que cria `championship_rounds`**. Todo o resto (Agenda, ChampionshipAdmin, Championships, PublicChampionshipPage) apenas lê ou edita. Um campeonato criado fora desse caminho nasce sem rodada nenhuma e não há como criá-las pela interface.

## Objetivo

Transformar o Sorteador Resenha Open em um **Criador de Campeonatos** genérico, reaproveitando o que já funciona. O menu passa de "Sorteador Resenha Open" para "Criador de Campeonatos".

Escopo: criação e inscrições genéricas para qualquer formato; geração de rodadas e montagem de chave (sorteio automático **ou** alocação manual). O sorteio específico do Resenha Open (`resenhaOpenDraw.ts`) permanece intacto e vira um dos sorteadores disponíveis.

## Restrições descobertas no código e no banco

Estas restrições moldam o design e precisam ser respeitadas.

**R1 — Rodadas não têm dimensão de classe.** `championship_rounds` tem `UNIQUE (championship_id, round_number)`. Como as classes têm conjuntos diferentes de rodadas (5ª = 4 rodadas, oitavas→final; 4ª = 5 rodadas, preliminar→final), duas classes não cabem no mesmo campeonato.

**R2 — O bug silencioso.** `createResenhaOpenRounds` verifica rodadas existentes só por `round_number`. Se o campeonato já tem o conjunto de uma classe, ele conclui que "já existem" e devolve um mapa com as **fases da classe errada**, sem erro. É assim que o Resenha Open 2026 acabou com as duas classes compartilhando as mesmas linhas de rodada — 16 partidas nas "Oitavas" (8 de cada classe) e 2 finais dentro da rodada "Final". Não corrompe dados, mas conflaciona: datas e status de rodada não podem ser definidos por classe.

**R3 — Grupos já são por classe.** `championship_groups` tem `category` (a classe) e `seed_registration_id`. Só as rodadas ficaram sem essa dimensão.

**R4 — Progressão de chave já é modelável.** `matches` tem `match_number`, `player_a_source_match_id` e `player_b_source_match_id`. Não é preciso inventar estrutura para ligar vencedor → próxima vaga.

**R5 — Cabeças de chave já existem.** `championship_registrations.cabeca_de_chave` (boolean) já está no schema e é usado pelo Resenha.

**R6 — `groupKnockout` é fixo em 2 grupos e 2 classificados.** `buildGroupKnockoutBracketData` faz `standings.slice(0, 2)` e filtra por `groupName === 'A' | 'B'`. Precisa ser generalizado, não apenas consumido.

**R7 — Participantes são só sócio ou convidado.** `CHECK (participant_type IN ('socio','guest'))`, mais `valid_participant` exigindo `user_id` para sócio e `guest_name` para convidado.

**R8 — Alunos não têm classe.** `non_socio_students` tem nome, plano, professor, responsável — nenhuma categoria de tênis.

**R9 — A apuração de pontos identifica rodadas por nome de fase.** `resolve_championship_final_phases` procura `phase ILIKE 'mata-mata-final%'`, `phase IN ('final','Final')`, `name = 'Final'`, e exclui `'%semi%'`. O gerador de rodadas precisa emitir fases desse vocabulário, senão a final não é reconhecida e os pontos não são apurados.

**R10 — Fase sem pontuação cadastrada vale 5.** `get_championship_phase_points` retorna NULL quando não há linha, e `apply_championship_edition_points` faz `IF v_raw_pts IS NULL THEN v_raw_pts := 5`. Igual a `participation`. Fases novas são seguras por padrão.

**R11 — Uma edição por série por ano.** `uidx_championship_series_edition_year` em `(series_id, edition_year)`. Descarta modelar "um campeonato por classe".

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | Campeonato **multi-classe**: rodadas ganham `class` | Casa com R3 e R11; corrige R1/R2 daqui pra frente |
| D2 | Rodadas geradas **ao fechar as inscrições** | Só aí o número real de inscritos é conhecido |
| D3 | Chave montável **manualmente**, em editor visual clicável | Requisito do admin; ver a chave enquanto monta é o que permite conferir cabeças |
| D4 | Passo de criação: essencial visível, pontuação em "Avançado" recolhido | Defaults do banco cobrem o caso comum |
| D5 | **Não** mexer no Resenha Open 2026 | Campeonato encerrado, 34 partidas reais |
| D6 | Pontuação de fases permanece como está; Campeonato Admin ganha visualização e edição | R10 torna fases novas inócuas por padrão |
| D7 | Admin atribui a classe do aluno **na inscrição** | R8: o cadastro do aluno não tem essa informação |

Sobre D5: as rodadas antigas ficam com `class = NULL`. Como Postgres trata NULLs como distintos em índice único, os dados existentes seguem válidos sem backfill. O Criador recusa gerar rodadas para campeonatos que tenham rodadas com `class` nulo, explicando que é um campeonato do modelo antigo.

## Modelo de dados

Quatro migrations, nenhuma tabela nova.

**M1 — Rodadas por classe.** `championship_rounds` ganha `class text`. A unicidade passa de `(championship_id, round_number)` para `(championship_id, class, round_number)`. Sem backfill (D5).

**M2 — Alunos.** `participant_type` passa a aceitar `'aluno'`; entra `student_id uuid REFERENCES non_socio_students(id)`; `valid_participant` ganha o braço `participant_type = 'aluno' AND student_id IS NOT NULL`. A classe do aluno vai na coluna `class` que já existe, preenchida pelo admin (D7).

**M3 — Vocabulário de fases.** `final_phase` passa a aceitar `round_of_32` e `qualifying`. **Nenhum ponto é semeado** para elas — por R10 valem 5, idêntico ao comportamento atual, até o admin decidir o contrário no editor.

**M4 — Configuração do formato.** `championships` ganha `format_config jsonb`. Guarda as escolhas do passo 2 num objeto tipado em vez de espalhar dez colunas que só fazem sentido para um formato cada.

## Arquitetura

`AdminResenhaOpen.tsx` tem 1012 linhas e cresceria para ~1600 se recebesse criação, configuração de formato e editor de chave. As responsabilidades saem para módulos testáveis isoladamente:

| Arquivo | Responsabilidade |
|---|---|
| `lib/championship/formatConfig.ts` | Tipos e validação das três configurações de formato |
| `lib/championship/creation.ts` | Criar campeonato e série (generaliza `createResenhaOpenChampionship`) |
| `lib/championship/rounds.ts` | Deriva rodadas de (config, classe, nº inscritos); respeita R9 |
| `lib/championship/bracket.ts` | Gera vagas, liga `source_match_id`, posiciona cabeças, valida |
| `lib/championship/seeding.ts` | Cabeças manuais ou via `fetchRanking(classe)` |
| `lib/championship/groupStage.ts` | Generaliza `groupKnockout` (R6) |
| `components/creator/CreatorSetup.tsx` | Passo 1 |
| `components/creator/CreatorFormat.tsx` | Passo 2 |
| `components/creator/CreatorRegistration.tsx` | Passo 3 |
| `components/creator/BracketEditor.tsx` | Passo 4 |

`AdminResenhaOpen.tsx` vira `ChampionshipCreator.tsx` e orquestra os passos. `resenhaOpenDraw.ts` e `resenhaOpenService.ts` permanecem; o sorteio do Resenha vira uma das opções do passo 4.

## Fluxo

### Passo 1 — Básico

Nome, série (escolher existente ou criar), formato, datas, classes participantes. `edition_year` derivado da data de início. Bloco "Avançado" recolhido com as regras de pontuação, pré-preenchido com os defaults do banco (vitória 3, WO 3, derrota 0, set 0, game 0, empate técnico 0, ranking final 200).

### Passo 2 — Formato

Apenas as opções do formato escolhido.

**Fase de grupos + mata-mata**
- Ida e volta nos grupos: sim/não
- Quantos grupos; quantos membros por grupo
- Quantos classificam por grupo
- Vagas para melhores terceiros: quantas (0 = nenhuma)
- Cabeça de chave no mata-mata: sim/não

**Pontos corridos**
- Ida e volta: sim/não
- Todos da mesma classe se enfrentam; sem grupos
- Fase final: sim/não. Se sim, onde começa (16avos / oitavas / quartas / semifinal)

**Mata-mata**
- Qualificatórias (*qualify*): sim/não. Se sim, quantos jogos, e em que vagas do quadro principal os vencedores entram
- Fase inicial do quadro principal (16avos / oitavas / quartas / semifinal)
- Cabeça de chave: sim/não

Validação em `formatConfig.ts`, com mensagem explicando o desencontro em vez de gerar chave torta:
- `nº grupos × membros por grupo` deve bater com os inscritos da classe
- `(classificados por grupo × nº grupos) + melhores terceiros` deve ser potência de 2
- vagas do quadro principal devem comportar os vencedores do qualify
- fase inicial deve comportar o número de participantes

### Passo 3 — Inscrições

Toggles de elegibilidade: sócios sempre; convidados sim/não; alunos sim/não. Ao inscrever aluno, o admin escolhe a classe (D7).

Cabeças de chave por duas vias:
- **Manual**: marcar na lista de inscritos
- **Por ranking**: escolher o número N; `fetchRanking(classe)` traz os N primeiros já ordenados, e o admin ajusta antes de confirmar

### Passo 4 — Chave

Fechar as inscrições dispara a geração das rodadas (D2), derivadas de formato × classe × nº de inscritos, com fases do vocabulário compatível com R9.

Duas saídas:

- **Sortear** — o sorteador depende do formato:
  - *mata-mata*: `resenhaOpenDraw.ts`, que já sorteia respeitando cabeças
  - *grupos + mata-mata*: encaminha para o `GroupDrawPage` existente
  - *pontos corridos*: não há sorteio — todos da classe se enfrentam, e as partidas são geradas direto da configuração
- **Montar à mão** — editor visual clicável: toca na vaga livre, escolhe entre os inscritos ainda não alocados. Cabeças destacados; o editor avisa, sem bloquear, quando dois caem no mesmo lado do quadro. Disponível para mata-mata e para a fase final de pontos corridos

### Campeonato Admin

Ganha uma seção para **visualizar e editar** `championship_phase_points` (D6): a tabela atual (champion 125, finalist 64, semifinal 35, quarterfinal 16, round_of_16 8, participation 5), com edição dos valores e inclusão de linha para as fases novas.

## Erros e idempotência

`createResenhaOpenChampionship` já procura campeonato equivalente antes de inserir. O mesmo princípio se estende a rodadas e chave: repetir um passo não duplica. Nada é gravado antes de o passo fechar.

O editor manual valida antes de salvar: vaga vazia, atleta em duas vagas, cabeças no mesmo lado do quadro. As duas primeiras bloqueiam; a terceira apenas avisa.

## Testes

Não existe teste de criação hoje. Entram:

- `formatConfig` — validação de cada formato, incluindo as combinações que não fecham
- `rounds` — derivação por formato × classe × N; fases compatíveis com R9
- `bracket` — posicionamento de cabeças, ligação qualify → quadro principal via `source_match_id`
- `seeding` — ranking vs manual
- `groupStage` — N grupos, N classificados, melhores terceiros

## Fora de escopo

- Sorteio novo para grupos+mata-mata: o `GroupDrawPage` existente é reaproveitado como está
- Backfill do Resenha Open 2026 (D5)
- Mexer em `resenhaOpenDraw.ts`
- Os wizards órfãos `NewChampionship.tsx` e `AdminTournaments.tsx` permanecem intocados; removê-los é limpeza separada

## Nota de tamanho

O escopo é grande para um único ciclo: quatro migrations, seis módulos novos em `lib/championship/`, quatro componentes e a seção de pontuação no Campeonato Admin. A quebra natural, caso o plano precise fasear:

1. Migrations + `formatConfig` + `creation` + passo 1 (criar campeonato genérico já funcionando ponta a ponta)
2. `rounds` + `seeding` + passo 3 (inscrições com alunos e cabeças por ranking)
3. `bracket` + `BracketEditor` + passo 4 (sorteio e montagem manual)
4. `groupStage` (generalização do R6) + seção de pontuação no Campeonato Admin

Cada fase deixa o app em estado utilizável.
