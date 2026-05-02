# PRD: 5ª Edição do "Resenha Open"

## 1. Introdução / Visão Geral

A **5ª Edição do "Resenha Open"** é um novo campeonato a ser implementado no app, com o diferencial de ter **dois formatos distintos de chaveamento por classe** (5ª Classe e 4ª Classe) e um **sorteador dedicado, visível apenas para admins**, capaz de gerar os confrontos com animação visual.

A 5ª Classe segue um mata-mata simples de 16 atletas (Oitavas → Quartas → Semis → Final). A 4ª Classe usa um formato especial com **3 fases de sorteio** (Qualify, 1ª Fase e Cabeças de Chave), comportando 19 atletas, dos quais 3 são cabeças de chave que entram direto nas Quartas.

O campeonato aceita **sócios e convidados**, mas a pontuação no ranking do app só é gerada para os sócios ao fim do campeonato, seguindo a **lógica genérica de pontos de campeonatos já implementada no app** (ex.: 3º Circuito de Inverno).

> **Observação:** apesar do nome conter "5ª Edição", esta é a **primeira edição do Resenha Open a ser cadastrada e disputada dentro do app**. As edições anteriores foram realizadas antes da implementação atual, portanto **não existe registro histórico do Resenha Open no sistema**. Toda a lógica de pontos descrita neste PRD se refere à lógica genérica de campeonatos já existente — não a uma "edição anterior do Resenha Open" no banco.

## 2. Objetivos

- Disponibilizar um sorteador admin-only com animação randômica para gerar confrontos das duas classes.
- Suportar dois formatos de chave distintos: mata-mata clássico de 16 (5ª Classe) e formato especial Qualify+Cabeças (4ª Classe, 19 atletas).
- Permitir cadastro/busca de atletas mistos (sócios + convidados não-cadastrados).
- Permitir que atletas oficialmente da **6ª classe** sejam inscritos na 5ª Classe do campeonato (a regra de "subir uma classe" se aplica apenas ao formato mata-mata clássico, não ao formato com Cabeças de Chave).
- Gerar tabela de confrontos por fases, visível a todos os usuários do app após o sorteio salvo.
- Aplicar a pontuação por fase alcançada, **somente para sócios**, ao final do campeonato — reutilizando a lógica/tabela genérica de pontos de campeonatos já implementada no app.
- Permitir refazer sorteio e editar confrontos manualmente **enquanto não houver resultados registrados**.

## 3. User Stories

### US-001: Modelagem do campeonato Resenha Open (estrutura de dados)
**Description:** Como desenvolvedor, preciso modelar a estrutura de dados que comporte os dois formatos (5ª Classe e 4ª Classe) com as fases especiais (Qualify, Classifica A/B, Cabeças de Chave) para que os sorteios sejam persistidos corretamente.

**Acceptance Criteria:**
- [ ] Modelo de campeonato suporta o tipo "Resenha Open 5ª Edição" com duas chaves filhas: 5ª Classe e 4ª Classe.
- [ ] Modelo de partidas suporta os identificadores de fase: `qualify`, `primeira_fase`, `segunda_fase`, `classifica_a`, `classifica_b`, `quartas`, `semifinal`, `final`.
- [ ] Modelo de inscrição suporta atletas sócios (FK para usuário) e convidados (campos avulsos: nome, idade, cidade).
- [ ] Modelo de inscrição na 4ª Classe possui flag `cabeca_de_chave` (boolean).
- [ ] Apenas **uma edição ativa** do Resenha Open por vez no banco — tentativa de criar nova edição com edição anterior aberta deve ser bloqueada.
- [ ] Migration aplicada com sucesso.
- [ ] Typecheck passa.

### US-002: Permissão admin-only para acesso ao sorteador
**Description:** Como admin, quero que apenas eu (e outros admins) tenham acesso ao sorteador, para que atletas não vejam o processo de geração dos confrontos.

**Acceptance Criteria:**
- [ ] Rota e UI do sorteador acessíveis apenas para usuários com role `admin`.
- [ ] Usuário não-admin que tente acessar a rota recebe redirecionamento ou 403.
- [ ] Item de menu "Sorteador Resenha Open" aparece apenas para admins.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-003: Cadastro de atletas para a 5ª Classe
**Description:** Como admin, quero cadastrar exatamente 16 atletas (sócios ou convidados) na 5ª Classe, para preparar o sorteio das Oitavas.

**Acceptance Criteria:**
- [ ] Tela mostra contador "X / 16 atletas inscritos".
- [ ] Busca de sócios por nome/CPF retorna lista de sócios elegíveis.
- [ ] Botão "Adicionar convidado" abre formulário com campos: nome (obrigatório), idade (obrigatório), cidade (obrigatório).
- [ ] **Atletas oficialmente da 6ª classe podem ser adicionados à 5ª Classe do campeonato** (regra de "subir uma classe", aplicável apenas a este formato simples). A busca de sócios deve permitir selecionar atletas com classe oficial 5ª **ou** 6ª.
- [ ] Botão remover atleta da lista antes do sorteio.
- [ ] Botão "Sortear" fica **desabilitado** enquanto número de atletas ≠ 16.
- [ ] Não permite duplicar o mesmo sócio na lista.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-004: Sorteio com animação da 5ª Classe (Oitavas)
**Description:** Como admin, quero clicar em "Sortear" e ver uma animação randômica que gera os 8 confrontos das Oitavas, para tornar o sorteio visualmente atrativo.

**Acceptance Criteria:**
- [ ] Ao clicar em "Sortear", animação randômica embaralha os atletas e os distribui em 8 confrontos (Jogo 1 a Jogo 8 das Oitavas).
- [ ] Após animação, tela mostra os 8 confrontos definidos.
- [ ] Botão "Refazer sorteio" disponível antes de salvar.
- [ ] Botão "Salvar confrontos" persiste o chaveamento e gera as fases automáticas (Quartas → Semis → Final) com placeholders "Vencedor Jogo X".
- [ ] Sorteio gera distribuição realmente aleatória (não determinística entre execuções).
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-005: Cadastro de atletas para a 4ª Classe com cabeça de chave
**Description:** Como admin, quero cadastrar exatamente 19 atletas na 4ª Classe, marcando 3 deles como cabeça de chave, para preparar o sorteio em 3 etapas.

**Acceptance Criteria:**
- [ ] Tela mostra contador "X / 19 atletas inscritos" e contador "X / 3 cabeças de chave".
- [ ] Busca de sócios e cadastro de convidados (nome, idade, cidade), igual à 5ª Classe.
- [ ] Cada atleta da lista possui toggle/checkbox "Cabeça de chave".
- [ ] **Atletas da 6ª classe oficial NÃO podem ser adicionados à 4ª Classe** (a regra "subir uma classe" aplica-se apenas à 5ª Classe — ver US-003). A busca de sócios na 4ª Classe deve restringir a atletas com classe oficial **4ª**.
- [ ] Botão "Iniciar sorteio" fica desabilitado se: total ≠ 19 OU número de cabeças de chave ≠ 3.
- [ ] Não permite duplicar sócio/convidado na lista nem entre 5ª Classe e 4ª Classe da mesma edição.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-006: Sorteio Etapa 1 — Qualify (jogos 1, 2, 3) da 4ª Classe
**Description:** Como admin, quero sortear 6 atletas elegíveis para os jogos antecipados (Qualify), para que apenas atletas locais não-cabeça-de-chave joguem essa fase.

**Acceptance Criteria:**
- [ ] Sistema identifica atletas elegíveis: **NÃO cabeças de chave** E (sócios OU convidados com cidade = "Sobral", case-insensitive, com trim).
- [ ] Bloqueia início do Qualify se houver menos de 6 atletas elegíveis (mostra mensagem de erro).
- [ ] Animação randômica seleciona 6 entre os elegíveis e os distribui em 3 confrontos (Jogo 1, Jogo 2, Jogo 3).
- [ ] Atletas de Sobral elegíveis que não foram sorteados continuam disponíveis para a Etapa 2 (1ª Fase).
- [ ] Botão "Refazer sorteio do Qualify" disponível.
- [ ] Botão "Avançar para sorteio da 1ª Fase" disponível após confirmação do Qualify.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-007: Sorteio Etapa 2 — 1ª Fase (jogos 4 a 9) da 4ª Classe
**Description:** Como admin, quero sortear os atletas restantes nos jogos 4 a 8, sabendo que o Jogo 9 é fixo (vencedor Jogo 1 x vencedor Jogo 2), para concluir a fase principal.

**Acceptance Criteria:**
- [ ] Pool de atletas para sorteio = 19 − 3 cabeças − 6 do Qualify = **10 atletas**.
- [ ] Animação distribui esses 10 atletas em 5 confrontos: Jogo 4, Jogo 5, Jogo 6, Jogo 7, Jogo 8.
- [ ] Jogo 9 é gerado **automaticamente** com placeholders "Vencedor Jogo 1" e "Vencedor Jogo 2" (não entra no sorteio).
- [ ] Botão "Refazer sorteio da 1ª Fase" disponível.
- [ ] Botão "Salvar e seguir para sortear cabeça de chave" avança para Etapa 3.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-008: Sorteio Etapa 3 — Cabeças de Chave (Quartas) da 4ª Classe
**Description:** Como admin, quero sortear os 3 cabeças de chave entre Quartas 1, 2 e 3, para finalizar o chaveamento.

**Acceptance Criteria:**
- [ ] Animação distribui aleatoriamente os 3 cabeças de chave entre as posições "Quartas 1", "Quartas 2" e "Quartas 3".
- [ ] Quartas 4 é fixa: "Classifica A vs Classifica B".
- [ ] Botão "Refazer sorteio dos cabeças de chave" disponível.
- [ ] Botão "Salvar campeonato e gerar tabela de confrontos" persiste o chaveamento completo da 4ª Classe.
- [ ] Estrutura final salva contém todas as fases com placeholders corretos:
  - 2ª Fase: Jogo 10 (Vencedor Jogo 3 × Vencedor Jogo 8), Jogo 11 (Vencedor Jogo 6 × Vencedor Jogo 7).
  - Classifica A: Vencedor Jogo 4 (sem confronto, avança direto).
  - Classifica B: Vencedor Jogo 5 (sem confronto, avança direto).
  - Quartas 1: Cabeça de Chave 1 × Vencedor Jogo 11.
  - Quartas 2: Cabeça de Chave 3 × Vencedor Jogo 9.
  - Quartas 3: Cabeça de Chave 2 × Vencedor Jogo 10.
  - Quartas 4: Classifica A × Classifica B.
  - Semifinal 1: Vencedor Quartas 1 × Vencedor Quartas 2.
  - Semifinal 2: Vencedor Quartas 3 × Vencedor Quartas 4.
  - Final: Vencedor Semifinal 1 × Vencedor Semifinal 2.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-009: Tabela pública de confrontos por fase
**Description:** Como qualquer usuário do app, quero ver a tabela de confrontos do Resenha Open separada por fases, para acompanhar o campeonato.

**Acceptance Criteria:**
- [ ] Tabela visível para todos os usuários (sócios e visitantes) no menu Campeonatos após o sorteio ser salvo.
- [ ] Confrontos agrupados por fase com cabeçalhos visuais distintos (Qualify, 1ª Fase, 2ª Fase, Quartas, Semifinal, Final), seguindo a referência visual da imagem do PRD.
- [ ] Confrontos exibem nome dos atletas (ou placeholder "Vencedor Jogo X" se ainda não definido).
- [ ] Toggle/abas separando 5ª Classe e 4ª Classe.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-010: Registro de resultados e avanço automático de fase
**Description:** Como admin, quero registrar o placar de cada confronto e ver o vencedor avançar automaticamente para o confronto seguinte.

**Acceptance Criteria:**
- [ ] Reusa fluxo de registro de resultados do último campeonato implementado.
- [ ] Ao salvar resultado, vencedor é propagado automaticamente para o próximo confronto (substitui placeholder "Vencedor Jogo X").
- [ ] Suporta marcação de **WO (walkover)** com mesmo comportamento do último campeonato.
- [ ] **Não há disputa de 3º lugar** — perdedores das semifinais não geram nova partida.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-011: Edição de confrontos e refazer sorteio antes de qualquer resultado
**Description:** Como admin, quero poder substituir um atleta em um confronto ou refazer o sorteio inteiro **enquanto nenhum resultado tiver sido registrado**, para corrigir erros do sorteio.

**Acceptance Criteria:**
- [ ] Botão "Refazer sorteio" disponível na tela de admin enquanto não houver nenhum resultado registrado nas partidas geradas.
- [ ] Botão "Editar confronto" permite substituir um atleta por outro inscrito que não esteja já alocado em outra partida.
- [ ] Após o primeiro resultado ser salvo, ambas as ações ficam **bloqueadas** (UI desabilita e backend rejeita).
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

### US-012: Apuração de pontos para sócios ao fim do campeonato
**Description:** Como admin, quero que ao encerrar o campeonato os sócios ganhem pontos no ranking do app, seguindo a lógica genérica de pontos de campeonatos já implementada no app (ex.: 3º Circuito de Inverno), e convidados não recebam pontos.

**Acceptance Criteria:**
- [ ] Reusar a lógica/tabela genérica de pontos por fase alcançada já implementada no app (não criar nova lógica de pontos exclusiva do Resenha Open).
- [ ] Apenas atletas com vínculo de sócio recebem pontos; convidados são ignorados na apuração.
- [ ] Apuração executada apenas após a Final ser registrada e o campeonato marcado como encerrado.
- [ ] **Pontos são aplicados sempre na classe oficial do sócio no ranking do app**, independentemente da classe disputada no campeonato. Ex: sócio de classe oficial 6ª que jogou na 5ª Classe do campeonato recebe os pontos correspondentes na sua **6ª classe oficial**.
- [ ] As fases especiais do Resenha Open (Qualify, Classifica A/B, 2ª Fase) devem ser **mapeadas para as fases canônicas** que a tabela de pontos genérica reconhece — ver Apêndice C.
- [ ] Apuração é **idempotente**: rodar duas vezes não duplica pontos.
- [ ] Typecheck passa.
- [ ] Verify in browser using dev-browser skill.

## 4. Requisitos Funcionais

- **FR-1:** O sistema deve criar uma nova entidade de campeonato "Resenha Open — 5ª Edição" com duas chaves filhas: 5ª Classe (16 atletas, mata-mata simples) e 4ª Classe (19 atletas, formato Qualify+Cabeças).
- **FR-2:** O sorteador deve estar acessível **somente para usuários com role admin**.
- **FR-3:** O cadastro de atletas deve permitir buscar sócios e cadastrar convidados (nome, idade, cidade).
- **FR-4:** Atletas com classe oficial = 6ª devem poder ser inscritos **apenas na 5ª Classe do campeonato** (formato mata-mata clássico). A 4ª Classe (formato Qualify+CC) deve aceitar somente atletas oficialmente da 4ª classe.
- **FR-5:** A 5ª Classe deve exigir **exatamente 16 atletas**; o botão "Sortear" deve ficar desabilitado caso contrário.
- **FR-6:** A 4ª Classe deve exigir **exatamente 19 atletas e exatamente 3 cabeças de chave**; o botão "Iniciar sorteio" deve ficar desabilitado caso contrário.
- **FR-7:** O sorteio da 5ª Classe deve gerar 8 confrontos das Oitavas com animação randômica.
- **FR-8:** O sorteio da 4ª Classe deve ser executado em 3 etapas: Qualify (jogos 1–3), 1ª Fase (jogos 4–8), Cabeças de Chave (Quartas 1, 2, 3).
- **FR-9:** O Qualify (4ª Classe) deve sortear apenas atletas elegíveis: **não cabeça de chave** E (sócios OU convidados com cidade = "Sobral").
- **FR-10:** O Jogo 9 da 4ª Classe deve ser gerado automaticamente como "Vencedor Jogo 1 × Vencedor Jogo 2", sem entrar no sorteio.
- **FR-11:** Cada etapa de sorteio deve permitir refazer antes de salvar/avançar.
- **FR-12:** Ao salvar o sorteio, o sistema deve gerar todas as partidas das fases subsequentes com placeholders ("Vencedor Jogo X", "Cabeça de Chave N", "Classifica A/B").
- **FR-13:** A tabela de confrontos deve ser visível para todos os usuários do app, agrupada por fase e separada por classe.
- **FR-14:** Ao registrar resultado, o vencedor deve ser propagado automaticamente para o confronto seguinte.
- **FR-15:** O admin deve poder refazer o sorteio inteiro ou editar confrontos manualmente **enquanto não houver nenhum resultado registrado**; após o primeiro resultado, ambas as ações ficam bloqueadas.
- **FR-16:** O sistema deve suportar registro de WO no mesmo padrão do último campeonato.
- **FR-17:** Não deve haver disputa de 3º lugar.
- **FR-18:** Ao encerrar o campeonato, o sistema deve apurar pontos somente para sócios, reutilizando a **lógica genérica de pontos de campeonatos já implementada no app** (não há um Resenha Open anterior cadastrado no sistema), de forma idempotente. Pontos são creditados na **classe oficial do sócio no ranking**, independentemente da classe disputada no campeonato. As fases especiais (Qualify, Classifica A/B, 2ª Fase) seguem o mapeamento do Apêndice C.
- **FR-19:** Apenas **uma edição ativa** do Resenha Open pode existir por vez. As duas chaves (5ª Classe e 4ª Classe) da mesma edição podem rodar em paralelo.

## 5. Não-Objetivos (Fora de Escopo)

- Disputa de 3º lugar (não haverá).
- Pontuação para convidados.
- Configuração customizada da tabela de pontos por edição (reutiliza a existente).
- Edição de confrontos ou refazer sorteio após qualquer resultado registrado.
- Múltiplas edições do Resenha Open ativas simultaneamente.
- Importação em massa de atletas (CSV/planilha) — cadastro é manual, um por um.
- Notificações automáticas para atletas (push/email) sobre confrontos sorteados.
- Sorteio com semente fixa / reprodutível.
- Disputa em formato diferente do mata-mata (não há fase de grupos).

## 6. Considerações de Design

- **Animação do sorteio:** randômica e visualmente atrativa, embaralhando nomes/avatares antes de fixá-los nos confrontos. Reutilizar componentes/lib de animação já existentes no app, se houver.
- **Tabela de confrontos:** seguir a referência visual da imagem do PRD (cabeçalhos coloridos por fase: azul-escuro Qualify, azul 1ª Fase, roxo 2ª Fase, laranja Quartas, verde Final).
- **Identificação de fase:** usar identificadores estáveis no banco (`qualify`, `primeira_fase`, `segunda_fase`, `classifica_a`, `classifica_b`, `quartas`, `semifinal`, `final`) para permitir UI agrupar/colorir por fase.
- **Reuso:** reutilizar componentes de campeonatos anteriores já implementados no app (busca de sócios, cadastro de convidado, tela de registro de resultado com placar de sets/3º set, lógica de WO, lógica genérica de apuração de pontos).
- **Validação de elegibilidade no Qualify:** comparação de cidade case-insensitive e com trim para evitar falsos negativos ("sobral", "Sobral ").

## 7. Considerações Técnicas

- **Persistência:** modelar partidas com referências a "vencedor de outra partida" para que o avanço automático seja propagação de FK, não cópia.
- **Concorrência:** apuração de pontos deve ser idempotente (proteção contra duplo clique / retries).
- **RLS / Permissões:** a tabela do sorteador (rascunho de sorteio) deve ter RLS restrita a admins; a tabela final de confrontos deve ser legível por todos.
- **Auditoria:** ações de sorteio, refazer sorteio, edição de confronto e registro de resultado devem entrar no sistema de admin audit logging já existente (commit `f24a9cb`).
- **Bloqueio de nova edição:** verificar a existência de edição ativa do Resenha Open antes de permitir criar nova (uniqueness parcial).

## 8. Métricas de Sucesso

- Admin consegue executar todo o sorteio da 5ª Classe em **menos de 2 minutos** (cadastro + animação + salvar).
- Admin consegue executar todo o sorteio da 4ª Classe (3 etapas) em **menos de 5 minutos**.
- Tabela de confrontos disponível publicamente imediatamente após o último "salvar" do sorteio.
- Zero divergências entre o resultado registrado e o avanço automático do vencedor para a fase seguinte.
- 100% dos sócios participantes recebem pontos corretos ao fim do campeonato; 0% dos convidados recebem pontos.

## 9. Decisões e Restrições

- **Pontuação para atletas em classe diferente da oficial:** os pontos são aplicados **sempre na classe oficial do sócio no ranking do app**, independentemente da classe disputada no campeonato. Ex: sócio oficialmente da 6ª que disputa a 5ª Classe do campeonato pontua na **6ª oficial**. Reforçando: a regra "subir uma classe" só permite que 6ª oficial dispute a **5ª Classe** do campeonato (formato simples) — a 4ª Classe (formato com Cabeças) só aceita atletas oficialmente da 4ª.
- **Tabela de pontos:** esta é a **primeira edição do Resenha Open cadastrada no app** (apesar do nome "5ª Edição"). Não há, portanto, um "Resenha Open anterior" para herdar lógica. A apuração reutiliza a **lógica genérica de pontos de campeonatos já implementada** (a mesma usada por outros campeonatos como o 3º Circuito de Inverno). O mapeamento das fases especiais para as fases canônicas dessa lógica genérica está no **Apêndice C**.
- **UI do sorteador:** **rota dedicada** (admin-only), separada da tela de gerenciamento de campeonatos. Confirmar visual com design antes da implementação.
- **Empate / placar inválido:** não existe empate no tênis. O registro de resultados deve **reutilizar o componente de placar existente**, que já reconhece sets vencidos e a necessidade de 3º set para desempate.
- **Convidado em mais de uma classe na mesma edição:** **bloqueado**. Um mesmo convidado (matched por nome+cidade ou identificador interno) não pode ser inscrito simultaneamente na 5ª Classe e na 4ª Classe da mesma edição. Mesma regra para sócios.

---

### US-013: Testes RED — sorteios e avanço de fase (lógica pura)

**Description:** Como desenvolvedor, quero suítes de teste RED (que falham antes da implementação) cobrindo a lógica de sorteio das duas classes e de avanço automático de vencedores, para garantir que as regras críticas estejam protegidas por regressão.

**Acceptance Criteria:**

- [ ] Suíte criada em `__tests__/resenhaOpenDraw.test.ts` cobrindo regras do sorteador (ver Apêndice A).
- [ ] Suíte criada em `__tests__/resenhaOpenAdvance.test.ts` cobrindo regras de avanço de fase (ver Apêndice B).
- [ ] Os testes são executáveis com `npm test` (vitest) e atualmente **falham** (estado RED) porque a implementação ainda não existe — assinaturas de função/módulos importados retornam `not implemented` ou não existem.
- [ ] Os testes não dependem de Supabase/rede — são puros sobre as funções de sorteio e propagação.
- [ ] Cada teste tem `describe`/`it` descritivo em português, espelhando os nomes dos casos listados nos apêndices.
- [ ] Para sorteios randômicos, as funções aceitam um parâmetro opcional de RNG injetável (ex: `rng?: () => number`) para permitir testes determinísticos. **Sem semente fixa em produção** — apenas em testes.
- [ ] Padrão de estrutura dos testes alinhado ao já existente em [`__tests__/groupKnockout.test.ts`](../__tests__/groupKnockout.test.ts).

---

## Apêndice A — Casos de Teste RED do Sorteio (`__tests__/resenhaOpenDraw.test.ts`)

A implementação do sorteador deve expor funções puras (independentes de Supabase) que recebem a lista de atletas inscritos + um RNG injetável e retornam a estrutura de partidas. As funções esperadas:

```ts
// 5ª Classe
drawClasse5(athletes: Athlete[], rng?: () => number): Match[]; // 8 confrontos das Oitavas

// 4ª Classe (etapas separadas, encadeadas)
drawClasse4Qualify(athletes: Athlete[], rng?: () => number): { qualifyMatches: Match[]; remainingPool: Athlete[] };
drawClasse4PrimeiraFase(remainingPool: Athlete[], rng?: () => number): Match[]; // 5 confrontos sorteados (jogos 4–8) + jogo 9 placeholder
drawClasse4CabecasDeChave(headSeeds: Athlete[], rng?: () => number): { quartas1: Athlete; quartas2: Athlete; quartas3: Athlete };

// Geração da estrutura completa de fases (após os sorteios)
buildClasse4Bracket(qualify: Match[], primeiraFase: Match[], quartasSeeds: { quartas1; quartas2; quartas3 }): Bracket;
```

### A.1 — 5ª Classe (`drawClasse5`)

- Deve **lançar erro** quando recebe número de atletas ≠ 16 (testar com 0, 15 e 17).
- Deve retornar exatamente **8 confrontos** quando recebe 16 atletas válidos.
- Deve incluir **cada atleta exatamente uma vez** entre os 16 slots (8 confrontos × 2 jogadores).
- Com RNG determinístico deve produzir **distribuição reproduzível** entre execuções.
- Deve **rejeitar atletas duplicados** (mesmo `id` aparecendo 2x na entrada).

### A.2 — 4ª Classe Qualify (`drawClasse4Qualify`)

- Deve **lançar erro** se total de atletas ≠ 19.
- Deve **lançar erro** se número de cabeças de chave (flag `cabeca_de_chave=true`) ≠ 3.
- Deve **lançar erro** se houver menos de 6 atletas elegíveis para o Qualify (não-CC E (sócio OU convidado com `cidade='Sobral'`)).
- **NÃO** deve incluir atletas marcados como cabeça de chave nos sorteados.
- **NÃO** deve incluir convidados cuja cidade ≠ "Sobral" (case-insensitive, com trim).
- **DEVE** considerar elegíveis convidados com cidade `"sobral"`, `"SOBRAL"` e `" Sobral "` (case-insensitive + trim).
- **DEVE** considerar elegíveis sócios não-CC independentemente da cidade cadastrada.
- Deve sortear exatamente **6 atletas** distribuídos em 3 confrontos (Jogo 1, 2, 3).
- Deve retornar `remainingPool` com **13 atletas** (19 − 6 sorteados).
- O `remainingPool` retornado deve **excluir os 3 cabeças de chave** (cabeças não vão para 1ª Fase).

### A.3 — 4ª Classe 1ª Fase (`drawClasse4PrimeiraFase`)

- Deve **lançar erro** se `remainingPool` ≠ 10 atletas (deve ser 19 − 6 Qualify − 3 CC).
- Deve gerar **5 confrontos sorteados** (Jogo 4, 5, 6, 7, 8).
- Deve gerar **Jogo 9 com placeholders fixos**: `winner_of: jogo_1` × `winner_of: jogo_2` (sem entrar no sorteio).
- Deve incluir cada atleta do pool exatamente uma vez entre os 10 slots dos jogos 4–8.

### A.4 — 4ª Classe Cabeças de Chave (`drawClasse4CabecasDeChave`)

- Deve **lançar erro** se `headSeeds.length` ≠ 3.
- Deve atribuir os **3 atletas distintos** entre `quartas1`, `quartas2` e `quartas3` (nenhuma duplicação).
- Com RNG determinístico deve produzir resultado reproduzível.

### A.5 — Bracket completo (`buildClasse4Bracket`)

- A 2ª Fase deve conter exatamente: `Jogo 10 = winner(jogo 3) × winner(jogo 8)` e `Jogo 11 = winner(jogo 6) × winner(jogo 7)`.
- `Classifica A` deve referenciar `winner(jogo 4)` sem partida disputada (avança direto).
- `Classifica B` deve referenciar `winner(jogo 5)` sem partida disputada (avança direto).
- `Quartas 1` deve ser `cabecaDeChave1 × winner(jogo 11)`.
- `Quartas 2` deve ser `cabecaDeChave3 × winner(jogo 9)`.
- `Quartas 3` deve ser `cabecaDeChave2 × winner(jogo 10)`.
- `Quartas 4` deve ser `Classifica A × Classifica B`.
- `Semifinal 1` deve ser `winner(quartas 1) × winner(quartas 2)`.
- `Semifinal 2` deve ser `winner(quartas 3) × winner(quartas 4)`.
- `Final` deve ser `winner(semifinal 1) × winner(semifinal 2)`.
- O bracket gerado **NÃO** deve conter partida de disputa de 3º lugar.

---

## Apêndice B — Casos de Teste RED do Avanço de Fase (`__tests__/resenhaOpenAdvance.test.ts`)

A função pura esperada:

```ts
// Recebe o bracket atual e o resultado de uma partida; retorna o bracket atualizado
// com o vencedor propagado para o slot dependente.
applyMatchResult(bracket: Bracket, matchId: string, winnerRegistrationId: string): Bracket;
```

### B.1 — Avanço 5ª Classe

- Registrar vencedor da Oitava 1 deve preencher o slot A das **Quartas 1**.
- Registrar vencedor da Oitava 2 deve preencher o slot B das **Quartas 1**.
- Registrar vencedor de duas Quartas deve preencher os slots da **Semifinal** correspondente.
- Registrar vencedor da Final deve marcar o campeonato como **encerrado**.
- Registrar resultado em partida cujo `winner_registration_id` não pertence a nenhum dos jogadores deve **lançar erro**.

### B.2 — Avanço 4ª Classe (Qualify → 1ª Fase)

- Registrar vencedor do **Jogo 1** deve preencher o slot A do **Jogo 9** (`winner_of: jogo_1`).
- Registrar vencedor do **Jogo 2** deve preencher o slot B do **Jogo 9**.
- Registrar vencedor do **Jogo 3** deve preencher o slot A do **Jogo 10** (`winner_of: jogo_3`).

### B.3 — Avanço 4ª Classe (1ª Fase → 2ª Fase)

- Registrar vencedor do **Jogo 4** deve preencher diretamente o slot A da **Quartas 4** (via `Classifica A`, sem partida intermediária).
- Registrar vencedor do **Jogo 5** deve preencher diretamente o slot B da **Quartas 4** (via `Classifica B`).
- Registrar vencedor do **Jogo 6** deve preencher o slot A do **Jogo 11**.
- Registrar vencedor do **Jogo 7** deve preencher o slot B do **Jogo 11**.
- Registrar vencedor do **Jogo 8** deve preencher o slot B do **Jogo 10**.

### B.4 — Avanço 4ª Classe (2ª Fase → Quartas)

- Registrar vencedor do **Jogo 10** deve preencher o slot oposto ao Cabeça de Chave 2 nas **Quartas 3**.
- Registrar vencedor do **Jogo 11** deve preencher o slot oposto ao Cabeça de Chave 1 nas **Quartas 1**.
- Registrar vencedor do **Jogo 9** deve preencher o slot oposto ao Cabeça de Chave 3 nas **Quartas 2**.

### B.5 — Avanço 4ª Classe (Quartas → Semis → Final)

- Registrar vencedor das **Quartas 1** e **Quartas 2** deve preencher os dois slots da **Semifinal 1**.
- Registrar vencedor das **Quartas 3** e **Quartas 4** deve preencher os dois slots da **Semifinal 2**.
- Registrar vencedor da **Semifinal 1** deve preencher o slot A da **Final**.
- Registrar vencedor da **Semifinal 2** deve preencher o slot B da **Final**.
- Registrar vencedor da **Final** deve marcar o campeonato como **encerrado** e disparar a apuração de pontos.
- O sistema **NÃO** deve criar nenhuma partida de disputa de 3º lugar entre os perdedores das semifinais.

### B.6 — Bloqueio de edição após resultado

- Tentar refazer sorteio (`redrawBracket`) com pelo menos uma partida com `status='finished'` deve **lançar erro**.
- Tentar editar confronto (`replaceAthleteInMatch`) com pelo menos uma partida com `status='finished'` deve **lançar erro**.
- Refazer sorteio quando **nenhuma** partida foi finalizada deve funcionar normalmente.

### B.7 — WO (walkover)

- Registrar WO em uma partida deve definir o adversário como vencedor e propagar o avanço normalmente.
- Registrar WO em ambos os atletas (caso degenerado) deve **lançar erro**.

---

## Apêndice C — Mapeamento de Fases → Pontos Genéricos

A lógica genérica de pontos do app (já implementada para outros campeonatos) reconhece as fases canônicas: **Oitavas**, **Quartas**, **Semifinal**, **Vice-campeão**, **Campeão**. As fases especiais do Resenha Open devem ser convertidas para essas fases canônicas no momento da apuração, conforme a tabela abaixo. **A pontuação é definida pela fase canônica final alcançada** — não há pontos extras pelas fases intermediárias.

### C.1 — 5ª Classe (mata-mata simples de 16)

| Fase alcançada (campeonato) | Fase canônica (pontos) |
| --- | --- |
| Eliminado nas Oitavas | Oitavas |
| Eliminado nas Quartas | Quartas |
| Eliminado na Semifinal | Semifinal |
| Vice-campeão (perdeu a Final) | Vice-campeão |
| Campeão | Campeão |

### C.2 — 4ª Classe (formato Qualify + Cabeças)

| Fase alcançada (campeonato) | Fase canônica (pontos) |
| --- | --- |
| Eliminado no Qualify (Jogos 1–3) | **Oitavas** (mesmo nível dos eliminados na primeira rodada eliminatória) |
| Eliminado na 1ª Fase (Jogos 4–9) | **Oitavas** |
| Eliminado na 2ª Fase (Jogo 10 ou 11) | **Oitavas** (não atingiu Quartas) |
| Cabeça de chave eliminado na Quartas (entrada direta) | **Quartas** |
| Vencedor de Classifica A/B eliminado na Quartas | **Quartas** |
| Eliminado nas Quartas (qualquer caminho) | **Quartas** |
| Eliminado na Semifinal | **Semifinal** |
| Vice-campeão | **Vice-campeão** |
| Campeão | **Campeão** |

### C.3 — Regras de classe para creditação

- A pontuação correspondente à fase canônica é creditada na **classe oficial do sócio no ranking**, não na classe disputada.
- Convidados não recebem pontos.
- Sócios eliminados antes da Quartas não recebem o bônus de "entrada direta nas Quartas" do Cabeça de Chave — esse bônus já está implícito na fase alcançada por cada sócio (CC eliminado nas Quartas pontua como Quartas, mesmo sem ter disputado fases anteriores).

### C.4 — Validação por teste

Os testes de US-013 (Apêndice B) devem incluir um caso adicional de mapeamento:

- Dado um sócio CC eliminado nas Quartas 1, a função de apuração deve retornar a fase canônica `quartas` e os pontos correspondentes.
- Dado um sócio eliminado no Jogo 1 (Qualify), a função deve retornar a fase canônica `oitavas`.
- Dado um sócio oficialmente da 6ª classe que ganhou a Final da 5ª Classe do campeonato, a creditação deve ocorrer na **6ª classe oficial** com a pontuação de `campeão`.
