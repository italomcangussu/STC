# Campeonatos: Chaveamento Operacional e Estatisticas

## Contexto

A tela publica/logada de Campeonatos hoje divide a experiencia em abas de Partidas, Jogos e Chaveamento. Para o Resenha Open e demais campeonatos mata-mata, isso espalha a operacao do usuario: o acompanhamento visual fica no chaveamento, mas as acoes de lancar resultado e editar horario ficam nas listas.

O objetivo aprovado e transformar o Chaveamento na central principal de uso e criar uma aba Estatisticas com analise do campeonato atual.

## Objetivos

- Remover as abas Partidas e Jogos do fluxo principal de campeonatos mata-mata.
- Manter Chaveamento como primeira aba operacional desses campeonatos.
- Abrir o chaveamento ja posicionado na fase atual do campeonato.
- Permitir clicar em qualquer card de jogo para abrir um modal overlay com acoes operacionais.
- Reutilizar as telas/funcoes existentes de Lancar resultado e Editar horario.
- Criar a aba Estatisticas com metricas por classe e atleta.
- Criar um simulador de odds baseado somente nas partidas do campeonato selecionado.

## Nao Objetivos

- Nao mudar regras esportivas, sorteio ou progressao automatica de chave.
- Nao criar apostas reais, carteira, saldo, pagamento ou registro de palpites.
- Nao usar historico geral do atleta fora do campeonato atual para odds.
- Nao reescrever os modais de resultado/agendamento quando o reuso existente for suficiente.
- Nao alterar o menu inferior do aplicativo.

## Navegacao

Para campeonatos `mata-mata` e `grupo-mata-mata`, as abas visiveis no menu Campeonatos passam a ser:

- `Chaveamento`
- `Estatisticas`
- `Classificacao`, apenas quando o formato ainda precisar de fase de grupos e a classificacao for aplicavel.

Para o Resenha Open, a aba inicial deve ser `Chaveamento`. As abas antigas `Partidas` e `Jogos` deixam de aparecer. O conteudo util delas passa a ser acessado pelo modal do jogo no chaveamento.

## Chaveamento

O componente de chaveamento deve continuar com o board navegavel, seletor de classe, zoom e conectores existentes.

Ao abrir a aba, o board deve centralizar automaticamente a fase atual:

- A fase atual e a fase mais proxima de execucao com partidas pendentes e participantes definidos.
- Se houver partidas pendentes em mais de uma fase, priorizar a fase mais antiga ainda nao concluida dentro da ordem do torneio.
- Se todas as partidas estiverem finalizadas, centralizar a final.
- Se ainda nao houver partidas com participantes definidos, centralizar a primeira fase.

Para o Resenha Open, a ordem de fases e:

- 4a Classe: `preliminar`, `oitavas`, `quartas`, `semifinal`, `final`.
- 5a Classe: `oitavas`, `quartas`, `semifinal`, `final`.

O comportamento deve preservar a liberdade atual de pan/zoom. A centralizacao automatica acontece na entrada da aba, na troca de classe e quando o usuario aciona reset.

## Modal do Jogo

Ao clicar ou tocar em um card de jogo no chaveamento, deve abrir um modal overlay fixo no viewport, renderizado fora do scroll interno do board.

O modal deve mostrar:

- Numero do jogo, fase e classe.
- Atletas ou placeholders de origem, como "Vencedor Jogo 5".
- Horario sugerido/agendado, quando existir.
- Placar atual, W.O. ou status finalizado, quando existir.
- Acoes disponiveis conforme permissoes atuais.

Acoes:

- `Lancar`: abre o fluxo atual de resultado usando a mesma validacao de sets, super tie, vencedor e propagacao de vencedor para a proxima fase.
- `Editar horario`: abre o modal atual de horario sugerido/agendamento, usando a mesma regra atual do Resenha Open.
- Se a partida estiver finalizada, o modal pode esconder a acao de lancar e destacar o resultado.
- Se o usuario nao tiver permissao para uma acao, a acao nao aparece.

O modal nao deve depender da posicao de scroll da pagina ou do board. Fechar o modal retorna o usuario ao mesmo ponto visual do chaveamento.

## Estatisticas

A aba Estatisticas usa somente dados do campeonato selecionado.

Ela deve ter filtro por classe e separar metricas por classe. Para cada atleta inscrito com partidas finalizadas, calcular:

- Partidas jogadas.
- Vitorias e derrotas.
- Aproveitamento de vitorias.
- Sets vencidos e perdidos.
- Saldo de sets.
- Games vencidos e perdidos.
- Saldo de games.
- Super ties vencidos/perdidos quando o terceiro set existir.
- W.O. vencido/perdido quando existir.
- Ultimo resultado no campeonato.

Atletas inscritos sem partida finalizada devem aparecer com estado sem dados suficientes, especialmente para o simulador.

## Simulador de Odds

O simulador deve permitir selecionar dois atletas da mesma classe do campeonato atual.

A probabilidade estimada deve ser derivada apenas das estatisticas do campeonato selecionado. A formula inicial aprovada para implementacao:

- Base de forca por atleta:
  - 45% aproveitamento de vitorias.
  - 25% aproveitamento de sets.
  - 20% aproveitamento de games.
  - 10% ajuste por saldo normalizado de sets/games.
- Aplicar suavizacao para poucos jogos, evitando odds extremas com uma unica partida.
- Converter a diferenca de forca em probabilidade entre 35% e 65% quando ambos tiverem poucos dados.
- Permitir probabilidades mais fortes quando ambos tiverem volume razoavel de partidas.

Odds decimais:

- Favorito recebe odd mais baixa.
- Azarao recebe odd mais alta.
- O sistema deve exibir que e uma simulacao informativa, sem aposta real.
- Quando nao houver dados suficientes para um ou ambos os atletas, mostrar odds neutras aproximadas e sinalizar baixa confianca.

## Componentes

Alteracoes esperadas:

- `components/Championships.tsx`
  - Ajustar abas visiveis e aba inicial.
  - Receber eventos do card de chaveamento.
  - Reaproveitar `ResultModal` e `MatchScheduleModal`.
- `components/ResenhaOpenBracketView.tsx`
  - Expor callback de selecao de partida e dados suficientes para modal.
  - Preservar realtime e dados de fallback.
- `components/ResenhaOpenTournamentBoard.tsx`
  - Substituir clique de apenas destacar por clique que seleciona/abre o jogo.
  - Centralizar fase atual.
- Novo helper de estatisticas, por exemplo `lib/championshipStats.ts`.
- Novo componente de aba, por exemplo `components/ChampionshipStatistics.tsx`.
- Novo modal operacional, por exemplo `components/ChampionshipMatchActionModal.tsx`.

## Dados

O calculo deve usar:

- `matches` do campeonato selecionado.
- `championship_rounds` para fase.
- `championship_registrations` para classe e identidade do atleta.
- Campos de placar `score_a` e `score_b`.
- Campos de vencedor `winner_registration_id`, `winner_id`, `walkover_winner_registration_id` e `is_walkover`.

Nao ha necessidade prevista de migration para a primeira versao.

## Permissoes

As permissoes devem seguir a logica atual:

- Admin pode lancar resultado e editar horario.
- Socio so pode lancar resultado quando a regra atual permitir.
- No Resenha Open, editar horario usa o modo de horario sugerido, como ja acontece na aba Partidas.

## Estados e Erros

- Sem chaveamento: mostrar estado vazio existente.
- Sem estatisticas: mostrar mensagem de aguardando partidas finalizadas.
- Sem dados suficientes para odds: mostrar simulacao neutra com baixa confianca.
- Erro ao salvar resultado/horario: manter tratamento atual com feedback existente.
- Atualizacao realtime: ao salvar resultado, chaveamento e estatisticas devem refletir os novos dados apos refetch.

## Testes

Adicionar ou atualizar testes para:

- Escolha da fase atual em diferentes estados do campeonato.
- Calculo de estatisticas por atleta e classe.
- Calculo de saldo de sets/games.
- Tratamento de W.O. no resumo estatistico.
- Conversao de estatisticas em odds, incluindo poucos dados.
- Renderizacao da aba Estatisticas sem dados.
- Build do projeto.

Validacao visual:

- Abrir Campeonatos no Resenha Open.
- Confirmar que Chaveamento e a aba inicial.
- Confirmar ausencia de Partidas/Jogos no fluxo principal.
- Confirmar centralizacao na fase atual em viewport mobile.
- Clicar em um card de jogo e confirmar modal overlay.
- Testar botoes Lancar e Editar horario abrindo os fluxos existentes.
- Confirmar aba Estatisticas com filtro de classe e simulador de odds.
