# Campeonato (Serra e Sertão 2026, chave, inscrição e Pix)

Leia antes de mexer em `components/TournamentBracketView.tsx`, `components/ResenhaOpenTournamentBoard.tsx`, `lib/bracketNavigation.ts`, `championship_registrations`/`championship_signups`, `conv_svc_receipt_championship_auto`, `conv_private.champ_confirm_from_entry` ou na chave do Serra e Sertão (id 8d8e7ec9-bb0a-4290-90f0-716bc0802b07).

## Chave oficial do Serra e Sertão 2026 (migration 20261103120000_serra_sertao_chave_oficial)
- A chave veio das imagens da organização e foi criada direto por migration, sem sorteio. Seeds definidos; campeonato em `ongoing`.
- 4ª Classe: fase `qualify` na rodada 1 (4 jogos, J1 a J4); os vencedores entram nos slots 2, 10, 14 e 6 das oitavas (`format_config.qualifying = {matchCount:4, entrySlots:[2,10,14,6]}`). As rodadas antigas da 4ª foram deslocadas para 2 a 5. Oitavas J5 a J12, quartas J13 a J16, semis J17 e J18, final J19.
- 5ª Classe: oitavas J1 a J8, quartas J9 a J12, semis J13 e J14, final J15.
- Os números de jogo se repetem entre as classes; o front separa por `bracket_class`. Nunca identificar um jogo só pelo número.
- Hermeson Veras joga as duas classes (exceção registrada em `championships.joao_info`, junto com o parágrafo "CHAVE OFICIAL" e os pares corretos da quali).

## Pré-inscrito com registration_id e confirmação de Pix
- Pré-inscritos que a organização já pôs na chave (Daniel Rodrigues, Derlan André, Ismael Pedrosa Machado, Ítalo Cangussu) ganharam `championship_registrations` e entraram na chave com o Pix pendente; o signup segue `pre` com `registration_id` preenchido.
- Regra: quando o signup já tem `registration_id`, `public.conv_svc_receipt_championship_auto` e `conv_private.champ_confirm_from_entry` só marcam o signup como confirmado/pago. Não criam outra inscrição (senão duplica a pessoa na chave).

## Armadilha: loading preso no StrictMode (components/TournamentBracketView.tsx)
- O loading do primeiro carregamento dependia de um ref (`primeiraCarga`). No StrictMode (dev) o efeito roda duas vezes, e o spinner nunca saía.
- Correção (af2e41a): o `finally` limpa o loading sempre que o efeito está ativo. Não condicionar o fim do loading a ref que sobrevive ao segundo disparo do efeito.

## Navegação e "Meu jogo" na chave (commits 210dc2c, 43f7fff)
- `lib/bracketNavigation.ts`: `PHASE_FOCUS_FRACTION` (1/3) é a mesma fração que `centerPhase` usa no quadro; `phaseAtScroll` dá a fase em foco pelo scroll/zoom; `sideOfUser(match, userId)` diz de que lado o usuário está; `findMyMatches(bracket, userId, classOrder)` devolve os jogos pendentes em ordem de classe e `match_number`, ou o último jogado se não há pendente. Se mudar a fração de foco, mude nos dois lugares.
- `fetchBracket` (`lib/resenhaOpenService.ts`) lê `user_id` das inscrições e preenche `registration_a_user_id`/`registration_b_user_id` em `BracketMatchWithPhase` (nulos para convidado ou vaga a definir). Sem mudança de banco.
- `ResenhaOpenTournamentBoard` recebe `currentUserId` (passado por `TournamentBracketView`, `ResenhaOpenBracketView` e `Championships` com `currentUser?.id`). Traz `PhaseStrip` (nav "Fases da chave", chips de 44 px com contagem, ponto laranja na fase em andamento, chip em foco segue o arrasto) e `MyMatchButton` ("Meu jogo"/"Meus jogos (n)") que troca a classe, centraliza e destaca o card; o card do usuário tem anel saibro e selo "Você".
- Cor: o botão usa saibro-700 porque branco sobre saibro-600 não passa 4,5:1. No celular a barra do topo omite o título (continua na imagem exportada) e exportar vira só ícone.
- Design (nota 85% em `.fabuloso/design/notas.json`). Pendente: textos de 11 px nos cabeçalhos dos cards, cores soltas (#061320, #0d2338) fora do cardápio, componente do quadro com ~800 linhas.

## Sistema visual da chave (design)
- As regras (papéis de cor, escala tipográfica 24/20/16/14/12, anatomia do card, conectores, movimento, alvos de 44 px) ficam em `.fabuloso/design/sistema.md`; leia antes de mexer no visual de `ResenhaOpenTournamentBoard.tsx` ou `TournamentBracketView.tsx`.
- `index.css` (`@theme`) tem a escala `noite` (50, 200, 400, 500, 600, 800, 900, 950): fundo azul-noite da chave. O 600 é só para conectores (não é texto); o 500 é o texto mínimo.
- Direção escolhida em 03/11/2026 (contrato em `.fabuloso/design/direcoes/chave.md`): A (Padrão, fundo noite) em todas as classes; D (Saibro) na 4ª Classe. B e C ficaram de fora. Commits 098a861, 3dda7b4.
- Tema por classe: `lib/bracketTheme.ts` (`temaDaClasse(classe)` devolve 'saibro' para '4ª Classe', senão 'noite'; teste em `__tests__/bracketTheme.test.ts`). O banco não guarda a superfície da classe, então a lista de classes de saibro mora nessa função.
- Cores: `index.css` define `.chave-noite` e `.chave-saibro` com as variáveis `--chave-*` (fundo, superfície, borda, texto, apoio, ativo, foco, conector, card-topo). O quadro lê as cores só por elas, sem hex solto; trocar de tema é só de cor.
- Card em `ResenhaOpenTournamentBoard.tsx`: 280x120 (topo 32 px + duas linhas de 44 px), check verde no vencedor (no lugar do trilho laranja), texto mínimo 12 px. `CARD_HEIGHT` em `lib/resenhaOpenBracketLayout.ts` passou de 88 para 120; se mudar o card, mude lá também.
