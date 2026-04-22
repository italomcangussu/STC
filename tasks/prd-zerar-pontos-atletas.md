# PRD: Zerar Pontos de Todos os Atletas

## Introdução

Criar uma funcionalidade administrativa para deixar em **0** os pontos de **todos os atletas ativos** no ranking geral do clube, de forma segura, auditável e reversível via backup. O objetivo é permitir reinício de ciclo (ex.: nova temporada) sem perder o histórico bruto de partidas.

Data de referência deste PRD: **21 de abril de 2026**.

## Objetivos

- Permitir que admins executem um reset global de pontuação em uma ação controlada.
- Garantir que, após o reset, todos os atletas apareçam com `totalPoints = 0` até novos jogos válidos no novo ciclo.
- Manter histórico de auditoria (quem executou, quando, motivo).
- Evitar impactos colaterais em autenticação, cadastros e histórico operacional.

## Premissas Assumidas

- O reset é **global** (não por atleta individual).
- O reset é **administrativo** e deve exigir confirmação forte.
- O reset deve afetar toda a pontuação que compõe o ranking atual (legado + desafios + superset), considerando apenas eventos após o marco de reset.

## User Stories

### US-001: Registrar evento de reset global
**Descrição:** Como admin, quero registrar formalmente um evento de reset para que o sistema saiba a partir de quando o ranking recomeça.

**Acceptance Criteria:**
- [ ] Existe estrutura persistente para evento de reset global (timestamp, admin executor, motivo opcional).
- [ ] O sistema permite apenas um reset efetivo por execução, com trilha de auditoria imutável.
- [ ] O horário de reset usa padrão único (UTC) no banco.
- [ ] Typecheck/lint passes.

### US-002: Executar reset de pontuação com segurança transacional
**Descrição:** Como admin, quero executar o reset em operação atômica para evitar estado parcial.

**Acceptance Criteria:**
- [ ] A operação roda em transação única (ou mecanismo equivalente de atomicidade no backend).
- [ ] Se qualquer etapa falhar, nenhuma mudança parcial permanece aplicada.
- [ ] O reset zera os campos legados de pontuação/estatística usados no ranking consolidado.
- [ ] A operação registra log estruturado de sucesso/falha.
- [ ] Typecheck/lint passes.

### US-003: Expor ação de reset no painel admin com dupla confirmação
**Descrição:** Como admin, quero uma ação explícita e protegida para evitar reset acidental.

**Acceptance Criteria:**
- [ ] A ação aparece apenas para usuários com papel `admin`.
- [ ] A UI exige duas confirmações: modal de risco + confirmação textual (ex.: digitar `ZERAR`).
- [ ] Exibe aviso de impacto: “Todos os atletas ficarão com 0 pontos no ranking atual”.
- [ ] Após sucesso, a UI mostra feedback claro de conclusão e horário do reset.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

### US-004: Recalcular ranking considerando marco de reset
**Descrição:** Como atleta, quero ver o ranking zerado após o reset para iniciar a nova temporada corretamente.

**Acceptance Criteria:**
- [ ] O cálculo de ranking ignora partidas/pontuações anteriores ao último reset global.
- [ ] Imediatamente após reset, todos os atletas ativos exibem `totalPoints = 0`.
- [ ] Novas partidas após reset voltam a pontuar normalmente.
- [ ] O cache de ranking é invalidado logo após reset.
- [ ] Typecheck/lint passes.

### US-005: Disponibilizar histórico de resets para auditoria
**Descrição:** Como admin, quero consultar resets já executados para rastreabilidade.

**Acceptance Criteria:**
- [ ] Existe listagem simples de resets com executor, data/hora e motivo.
- [ ] A listagem é somente leitura para perfis autorizados.
- [ ] Os dados persistem entre sessões e deploys.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser using dev-browser skill.

## Requisitos Funcionais

1. `FR-1`: O sistema deve permitir reset global de pontuação apenas para usuários `admin` autenticados.
2. `FR-2`: O reset deve registrar um evento versionado (`ranking_reset_event`) com `executed_by`, `executed_at`, `reason`.
3. `FR-3`: O cálculo de ranking deve considerar o último `executed_at` como marco de início do ciclo atual.
4. `FR-4`: O reset deve invalidar cache de ranking imediatamente após conclusão.
5. `FR-5`: O reset deve atualizar/zerar os campos legados usados na composição do ranking (ex.: `legacy_points` e correlatos de legado).
6. `FR-6`: A interface de admin deve exigir dupla confirmação antes de executar a ação.
7. `FR-7`: O sistema deve mostrar resultado da execução (sucesso/falha) com mensagem amigável e dados de auditoria básicos.
8. `FR-8`: O sistema deve bloquear concorrência para evitar dois resets simultâneos.
9. `FR-9`: A operação deve produzir logs estruturados para observabilidade.

## Não Objetivos (Out of Scope)

- Não incluir reset seletivo por atleta.
- Não incluir edição manual de pontos atleta a atleta nessa entrega.
- Não apagar histórico bruto de partidas do banco.
- Não redesenhar regras de desempate do ranking nesta entrega.

## Considerações de Design

- A ação deve ficar em área de alto risco no Admin, com cor e microcopy de alerta.
- Exibir texto de impacto e irreversibilidade operacional sem backup.
- Exibir data/hora do último reset no módulo de ranking/admin.

## Considerações Técnicas

- Pontuação atual vem de combinação de campos legados (`profiles`) + partidas finalizadas (`matches`) em `lib/rankingService.ts`.
- Para garantir `totalPoints = 0` para todos após reset, o cálculo precisa respeitar marco temporal do reset para componentes derivados de partidas.
- Recomendado criar migration para tabela de eventos de reset + política RLS restrita a admin.
- Recomendado implementar endpoint/RPC administrativo para centralizar validação, atomicidade e auditoria.
- Garantir compatibilidade com cache atual de 30s em ranking e forçar refresh pós-reset.

## Métricas de Sucesso

- 100% dos atletas ativos com `totalPoints = 0` até 5 segundos após reset concluído.
- 0 incidentes de reset acidental após entrada em produção (com dupla confirmação).
- 100% dos resets com trilha completa (executor + timestamp + status).
- Tempo de execução do reset abaixo de 10 segundos para base atual.

## Questões em Aberto

- O reset deve também zerar vitórias/sets/games exibidos no ranking, ou apenas pontos?
- Deve existir janela de bloqueio (ex.: impedir reset durante partidas em andamento)?
- Será permitido apenas 1 reset por dia/mês para reduzir risco operacional?
- Precisamos de funcionalidade de “simulação de impacto” antes de confirmar?

