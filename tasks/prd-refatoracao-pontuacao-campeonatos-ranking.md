# PRD: Refatoração do Sistema de Pontuação de Campeonatos e Ranking

## 1. Introduction / Overview

O sistema atual acumula pontos de campeonatos e desafios sem vínculo entre edições de um mesmo torneio e sem considerar mudança de classe dos atletas. Isso gera inconsistências: atletas mantêm pontos de classes inferiores indefinidamente, edições subsequentes do mesmo torneio somam em vez de substituir pontos anteriores, e pontos de Desafio/SUPERSET permanecem válidos após novos confrontos.

Esta refatoração introduz:
- **Séries de campeonato** (pai → edições anuais) para que pontos "defendam" edição contra edição. Um campeonato pode ter várias classes participando numa mesma edição; a classe está na inscrição do atleta, não no campeonato.
- **Divisão por 2** aplicada sempre que pontos forem ganhos em classe **inferior** à classe atual do atleta no ranking — cobrindo tanto promoções retroativas quanto participação voluntária em classe inferior.
- **Pontuação padronizada** por fase eliminatória (125 / 64 / 35 / 16 / 8 / 5).
- **Gestão head-to-head** para pontos de Desafio (8) e SUPERSET (3) que se invalidam no próximo confronto entre os mesmos atletas.
- **Marco de corte** no "3º CIRCUITO DE INVERNO": ranking zera a partir dele e a nova lógica passa a valer retroativamente para quem mudou de classe desde então.

## 2. Goals

- Garantir que cada edição anual de um torneio substitua (não some) os pontos da edição anterior para o mesmo atleta.
- Padronizar a pontuação por fase em todos os campeonatos eliminatórios.
- Aplicar automaticamente divisão por 2 aos pontos de atletas promovidos de classe, revertendo à pontuação integral quando o atleta defender ou conquistar novos pontos na classe atual.
- Rastrear corretamente a validade dos pontos de Desafio e SUPERSET através de histórico head-to-head.
- Excluir convidados/não-sócios do ranking sem afetar a pontuação recebida pelo sócio adversário.
- Realizar a virada a partir do "3º CIRCUITO DE INVERNO" com auditoria completa das mudanças.

## 3. User Stories

### US-001: Criar tabela `championship_series` e relacionar com `championships`
**Description:** Como desenvolvedor, preciso de uma tabela-pai que agrupe edições anuais de um mesmo campeonato, para que a lógica de "defesa de pontos" saiba qual edição substitui qual. O campeonato em si não tem classe — as classes participantes são definidas por inscrição (`championship_registrations.class`).

**Acceptance Criteria:**
- [ ] Migration cria tabela `championship_series` (`id`, `name`, `slug`, `created_at`, `created_by`).
- [ ] Adiciona `series_id UUID` e `edition_year INTEGER` em `championships` (nullable inicialmente).
- [ ] Adiciona índice único `(series_id, edition_year)` para impedir duas edições do mesmo torneio no mesmo ano.
- [ ] Backfill: cria série "Circuito de Inverno" e associa edições existentes (1º, 2º, 3º).
- [ ] RLS: leitura pública, escrita restrita a admin.
- [ ] Typecheck passa.

### US-002: UI admin para gerenciar séries e criar nova edição
**Description:** Como admin, quero criar um novo campeonato escolhendo uma série existente (ou criando nova) para que ele herde as regras de defesa de pontos.

**Acceptance Criteria:**
- [ ] Em [NewChampionship.tsx](components/NewChampionship.tsx), campo "Série" com autocomplete sobre `championship_series` + botão "Nova série".
- [ ] Campo `edition_year` preenchido automaticamente com ano da data de início, editável.
- [ ] Valida unicidade `(series_id, edition_year)` antes de salvar.
- [ ] Lista em [Championships.tsx](components/Championships.tsx) mostra "3º CIRCUITO DE INVERNO" como pertencente à série.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-003: Centralizar escala de pontuação por fase
**Description:** Como sistema, preciso de uma fonte única de verdade para os pontos por fase (125/64/35/16/8/5) usada em todos os campeonatos.

**Acceptance Criteria:**
- [ ] Constante/tabela `championship_phase_points` com: `champion=125, finalist=64, semifinal=35, quarterfinal=16, round_of_16=8, participation=5`.
- [ ] Remove valores hardcoded divergentes em [lib/championshipUtils.ts](lib/championshipUtils.ts) e migrations antigas.
- [ ] Função `get_championship_phase_points(phase TEXT)` no banco.
- [ ] Typecheck passa.

### US-004: Lógica de "defesa de pontos" entre edições
**Description:** Como atleta, quando uma nova edição do mesmo campeonato acontece, meus pontos da edição anterior são substituídos pelos da edição atual, refletindo a variação no ranking. A defesa é por `(user_id, series_id)` — independente da classe em que o atleta participou em cada edição.

**Acceptance Criteria:**
- [ ] Função `apply_championship_edition_points(championship_id)` que, ao finalizar edição:
  - Identifica pontos ativos do atleta referentes à edição anterior da mesma série (qualquer classe).
  - Remove (via `point_history` com `amount` negativo e `reason='defense_removal'`).
  - Adiciona pontos da edição atual conforme fase alcançada (aplicando divisão por 2 se classe de inscrição for inferior à classe de ranking do atleta — ver US-005).
- [ ] `point_history` ganha colunas `series_id`, `edition_year`, `phase`, `registration_class` para permitir a busca e auditoria.
- [ ] Variação exibida no perfil: "Defendeu X, ganhou Y, saldo ±Z".
- [ ] Teste unitário cobre: campeão em 2025 (+125) → semifinal em 2026 (→ -125, +35, saldo -90).
- [ ] Typecheck e testes passam.

### US-005: Regra geral de "pontos em classe inferior valem metade"
**Description:** Como sistema, pontos conquistados em classe inferior à classe atual do atleta no ranking valem metade. Isso cobre dois cenários: (a) promoção de classe retroativamente reclassifica pontos antigos; (b) atleta de classe superior se inscreve voluntariamente em classe inferior e recebe pontos já divididos no momento da consagração. Inscrição em classe **superior** à do ranking mantém pontos integrais.

**Acceptance Criteria:**
- [ ] **Cenário A (promoção):** Trigger `on_profile_class_change` detecta mudança de `profiles.class` para classe superior e insere linha em `point_history` com `reason='class_promotion_adjustment'` e `amount` = -(FLOOR(pontos_atuais/2)).
- [ ] Rebaixamentos não alteram pontos (mantêm integrais).
- [ ] **Cenário B (inscrição em classe inferior):** Em `apply_championship_edition_points`, se `championship_registrations.class` < `profiles.class` no momento da consagração, os pontos inseridos são `FLOOR(phase_points/2)` com `reason='championship_earn_lower_class'`.
- [ ] **Cenário neutro/superior:** Inscrição em classe igual ou superior à do ranking insere pontos integrais (`reason='championship_earn'`).
- [ ] Snapshot de toda mudança de classe em nova tabela `class_change_events` (`user_id`, `from_class`, `to_class`, `points_before`, `points_after`, `changed_at`, `changed_by`). Trigger idempotente.
- [ ] Dependentes que viram sócios diretos no meio de um ciclo são tratados como sócios normais com essas regras, sem reprocessamento retroativo do histórico.
- [ ] Testes cobrem:
  - Atleta 5ª com 125 pts promovido para 4ª → 62 pts (FLOOR).
  - Atleta 5ª se inscreve e vence na 4ª (superior) → +125 pts integrais.
  - Atleta 5ª se inscreve e vence na 6ª (inferior) → +62 pts (FLOOR).
- [ ] Typecheck e testes passam.

### US-006: Migração inicial — corte no 3º CIRCUITO DE INVERNO
**Description:** Como admin, preciso de uma migração única que zere o ranking e reprocesse a partir do 3º CIRCUITO DE INVERNO, aplicando divisão por 2 para atletas cuja classe de inscrição no torneio ficou inferior à classe atual de ranking.

**Acceptance Criteria:**
- [ ] Migration SQL faz:
  1. Snapshot de `profiles.class` atual em `class_change_events` (como estado pós-3º Circuito).
  2. Chama `admin_reset_ranking_full` (já existe em [20260421153000_full_ranking_reset.sql](supabase/migrations/20260421153000_full_ranking_reset.sql)).
  3. Reaplica pontos do 3º CIRCUITO DE INVERNO via `apply_championship_edition_points`.
  4. Para cada atleta, compara `championship_registrations.class` (classe em que jogou o 3º Circuito) com `profiles.class` atual: se a classe de inscrição ficou inferior (atleta foi promovido), aplica FLOOR(pontos/2).
- [ ] Log em `ranking_reset_events` com `reason='refactor_points_from_3_circuito_inverno'`.
- [ ] Dry-run mode disponível (retorna diff sem aplicar).
- [ ] Rollback script presente.
- [ ] Typecheck passa.

### US-007: Pontos de Desafio e SUPERSET head-to-head
**Description:** Como atleta, pontos ganhos em Desafio (8) ou SUPERSET (3) permanecem válidos apenas até meu próximo confronto contra o mesmo adversário.

**Acceptance Criteria:**
- [ ] Nova tabela `head_to_head_points` (`id`, `winner_id`, `loser_id`, `match_type` ['challenge'|'superset'], `points`, `match_id`, `is_active`, `created_at`, `invalidated_at`, `invalidated_by_match_id`).
- [ ] Ao registrar novo Desafio/SUPERSET entre atletas A e B:
  - Busca `head_to_head_points` ativo onde `{winner,loser}={A,B}`.
  - Marca `is_active=false`, `invalidated_by_match_id=novo_match_id`.
  - Insere `point_history` negativo para o perdedor anterior.
  - Cria novo registro ativo com o vencedor atual.
- [ ] Ranking ignora pontos com `is_active=false`.
- [ ] UI do perfil mostra "Pontos em defesa (head-to-head): X contra Y".
- [ ] Teste cobre cenário: A vence B (A +8) → B vence A (A -8, B +8).
- [ ] Typecheck e testes passam.

### US-008: Convidados não afetam nem são afetados pelo ranking
**Description:** Como sistema, partidas contra convidados/não-sócios geram pontos normalmente para o sócio, mas o convidado não entra no ranking.

**Acceptance Criteria:**
- [ ] `apply_championship_edition_points` e trigger de Desafio/SUPERSET ignoram usuários com flag de convidado/não-sócio ao inserir `point_history`.
- [ ] Consultas de ranking já filtram convidados (validar que continuam).
- [ ] Teste cobre: sócio vence convidado em Desafio → sócio ganha 8 pts, convidado não recebe linha em `point_history`.
- [ ] Typecheck e testes passam.

### US-009: Atualizar [Ranking.tsx](components/Ranking.tsx) com nova lógica
**Description:** Como atleta, quero ver no ranking meus pontos atuais já refletindo defesas, promoções e head-to-head.

**Acceptance Criteria:**
- [ ] Ranking lê de `get_active_user_points()` atualizado (já existe em [20260103153404_create_points_calc_function.sql](supabase/migrations/20260103153404_create_points_calc_function.sql)) considerando apenas linhas com `is_active` (ou soma algébrica de `point_history`).
- [ ] Tooltip/drawer no item do ranking mostra breakdown: "Campeonatos: X", "Head-to-head: Y", "Ajuste de classe: Z".
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-010: Painel "Pontos a Defender" no perfil do atleta
**Description:** Como atleta, quero ver quais pontos estão em risco na próxima edição de cada campeonato e em cada matchup head-to-head.

**Acceptance Criteria:**
- [ ] Nova aba/seção no perfil lista:
  - Por série de campeonato: "3º Circuito de Inverno — Campeão (125 pts) — próxima edição em {ano}".
  - Head-to-head: "8 pts vs João — válidos até próximo confronto".
- [ ] Ordena por maior exposição (mais pontos a defender primeiro).
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-011: Painel admin de edições e séries
**Description:** Como admin, quero ver e gerenciar todas as séries e suas edições para auditar e corrigir associações.

**Acceptance Criteria:**
- [ ] Em [ChampionshipAdmin.tsx](components/ChampionshipAdmin.tsx), aba "Séries" lista séries com suas edições por ano.
- [ ] Pode reassociar um campeonato a outra série (com confirmação — recalcula pontos).
- [ ] Pode criar/editar/arquivar série (nome/slug).
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-012: Cancelamento de edição reverte e re-aplica edição anterior
**Description:** Como admin, quando eu cancelo uma edição de campeonato após os pontos terem sido aplicados, o sistema deve reverter os pontos da edição cancelada e reaplicar os pontos da edição anterior da mesma série, mediante confirmação explícita.

**Acceptance Criteria:**
- [ ] Ao marcar um `championship` como `status='cancelled'` após pontos aplicados, exibir modal de confirmação: "Reverter pontos desta edição e reaplicar pontos da edição anterior? Isso alterará o ranking."
- [ ] Função `revert_championship_edition_points(championship_id)`:
  - Anula linhas em `point_history` vinculadas à edição (soft-delete via `reason='edition_cancelled'` e `amount` negativo).
  - Busca edição anterior da mesma série e reaplica pontos via `apply_championship_edition_points` (respeitando regra de classe inferior/superior do momento).
- [ ] Log de auditoria em `ranking_reset_events` com `reason='edition_cancellation'`.
- [ ] Teste cobre: 2025 campeão (+125) → 2026 campeão (defesa -125, +125) → 2026 cancelado (reverte, volta para +125 do 2025).
- [ ] Typecheck e testes passam.
- [ ] Verify in browser using dev-browser skill.

## 4. Functional Requirements

- **FR-1:** O sistema deve manter tabela `championship_series` como pai de `championships`, relacionada por `series_id` e distinguindo edições por `edition_year`.
- **FR-2:** Para cada `series_id`, só pode existir uma edição por `edition_year` (o campeonato não tem classe; classes participantes vêm de `championship_registrations.class`).
- **FR-3:** A pontuação por fase deve ser fixa e única em todo o sistema: Campeão=125, Finalista=64, Semifinal=35, Quartas=16, Oitavas=8, Participação=5.
- **FR-4:** Ao encerrar uma edição, o sistema deve remover os pontos da edição anterior da mesma série que o atleta ainda possui (independente da classe em que participou) e inserir os pontos da edição atual conforme fase alcançada.
- **FR-5:** Pontos conquistados em classe **inferior** à classe atual do atleta no ranking valem metade (FLOOR(pontos/2)). Aplica-se em dois cenários:
  - (a) Promoção de classe: pontos acumulados da classe agora inferior são ajustados retroativamente.
  - (b) Inscrição voluntária em classe inferior: pontos já entram divididos.
- **FR-6:** Pontos conquistados em classe igual ou **superior** à classe atual do atleta no ranking são integrais. Rebaixamentos de classe não alteram pontos acumulados.
- **FR-7:** Pontos de Desafio (8) e SUPERSET (3) devem ficar em `head_to_head_points` com `is_active=true` até o próximo confronto entre os mesmos dois atletas, quando o registro anterior é invalidado e um novo é criado.
- **FR-8:** Divisão por 2 deve usar `FLOOR(pontos/2)` (arredondamento para baixo) para evitar fracionários no ranking.
- **FR-9:** Partidas envolvendo convidados/não-sócios não devem gerar linhas em `point_history` nem em `head_to_head_points` para o lado convidado; o sócio recebe normalmente.
- **FR-10:** Ranking deve somar apenas pontos ativos (`point_history.amount` líquido + `head_to_head_points.is_active=true`).
- **FR-11:** Migração inicial deve:
  - Zerar ranking via `admin_reset_ranking_full`.
  - Reaplicar pontos do "3º CIRCUITO DE INVERNO" (todas as classes participantes).
  - Comparar `championship_registrations.class` (classe em que jogou) com `profiles.class` atual; se a classe em que jogou ficou inferior, aplicar divisão por 2.
  - Registrar cada ajuste em `class_change_events`.
- **FR-12:** Toda alteração em pontos deve ser rastreável via `point_history.reason` com valores: `championship_earn`, `championship_earn_lower_class`, `defense_removal`, `class_promotion_adjustment`, `head_to_head_earn`, `head_to_head_invalidation`, `edition_cancelled`, `manual_admin`.
- **FR-13:** UI pública de perfil do atleta deve expor "Pontos a Defender" (acessível a qualquer visitante) listando exposição por série e por matchup head-to-head.
- **FR-14:** UI admin deve permitir criar/editar séries, associar campeonatos existentes a séries e visualizar o histórico de edições.
- **FR-15:** Cancelamento de uma edição após pontos aplicados deve exigir confirmação explícita do admin e, uma vez confirmado, reverter os pontos da edição cancelada e reaplicar os pontos da edição anterior da mesma série.
- **FR-16:** Dependentes que migram para conta de sócio direto no meio de um ciclo são tratados como sócios normais para fins de ranking, sem reprocessamento retroativo do histórico anterior à migração.

## 5. Non-Goals (Out of Scope)

- Não haverá recálculo retroativo de campeonatos **anteriores** ao 3º CIRCUITO DE INVERNO (eles permanecem como histórico sem efeito no ranking).
- Não haverá lógica especial para atletas rebaixados — mantêm pontos integrais.
- Não haverá reprocessamento retroativo do histórico de dependentes que viraram sócios diretos — valem como sócios a partir do momento da migração.
- Não haverá pontuação intermediária para fases não listadas (ex: pré-oitavas) — mapeiam para "Oitavas" ou "Participação" conforme regra do admin.
- Não haverá notificações automáticas para atletas quando pontos forem invalidados (escopo de uma próxima iteração).
- Não haverá exportação em PDF das mudanças do ranking nesta iteração.
- Não haverá versionamento de escalas de pontos (mudança da tabela de fases é global).
- SUPERSET não terá variação por classe — sempre vale 3 pts fixos.

## 6. Design Considerations

- Reutilizar componentes de listagem e badge já usados em [Championships.tsx](components/Championships.tsx) e [Ranking.tsx](components/Ranking.tsx).
- Drawer/modal de breakdown seguir padrão [MODAL_PATTERN.md](MODAL_PATTERN.md).
- "Pontos a Defender" no perfil: card com barra de progresso indicando "exposição" (total a defender / total atual).
- Indicador visual sutil (ícone de escudo) ao lado dos pontos no ranking para pontos em defesa iminente (próxima edição nos próximos 30 dias).

## 7. Technical Considerations

- Todas as alterações em `point_history` via transação para evitar estados intermediários incorretos no ranking.
- Trigger em `profiles` para mudança de classe deve ser idempotente (não reaplicar ajuste se já houver evento em `class_change_events` para a mesma transição).
- Função `apply_championship_edition_points` deve ser idempotente: reexecutar não duplica pontos (chave `(user_id, championship_id, reason)` em `point_history`).
- `head_to_head_points` precisa de índice em `(LEAST(winner_id,loser_id), GREATEST(winner_id,loser_id), is_active)` para lookup rápido por par.
- Validar impacto em [lib/rankingService.ts](lib/rankingService.ts) e [lib/championshipStandings.ts](lib/championshipStandings.ts).
- Atualizar testes em [__tests__/championshipStandings.test.ts](__tests__/championshipStandings.test.ts).
- Considerar que `admin_reset_ranking_full` já existe e preserva `legacy_points` — a nova migração deve usar esse mecanismo em vez de criar um paralelo.
- Migração deve ter **dry-run** obrigatório antes do apply em produção, dado o risco.

## 8. Success Metrics

- 100% dos campeonatos existentes associados a uma `championship_series` após a migração.
- Ranking pós-3º CIRCUITO DE INVERNO reconciliável: para cada atleta, `SUM(point_history.amount) = ranking_points`.
- Zero inconsistências de pontos duplicados de edições anteriores (validado por query de auditoria).
- Tempo de consulta do ranking completo < 500ms para até 500 atletas.
- Todo ajuste de pontos rastreável via `point_history.reason` (0 linhas com reason nulo pós-migração).
- Admin consegue criar uma nova edição de série existente em < 3 cliques.

## 9. Open Questions

Todas as perguntas iniciais foram respondidas e incorporadas ao PRD:

- Dependentes → sócios: tratados como sócios normais, sem reprocessamento (FR-16).
- Cancelamento de edição: reverte + reaplica edição anterior, com confirmação explícita (FR-15, US-012).
- Campeonato não muda de classe — a classe é do atleta, via `championship_registrations` (FR-2).
- Painel "Pontos a Defender" é público (FR-13).
- SUPERSET: 3 pts fixos, sem variação por classe (Non-Goals).
- Inscrição em classe diferente da de ranking: inferior divide por 2 no momento; superior mantém integral (FR-5, FR-6).

Nenhuma pergunta pendente — PRD pronto para plano de implementação.
