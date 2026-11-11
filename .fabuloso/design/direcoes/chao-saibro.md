# Direção escolhida · Chão de saibro ("Noite de jogo")

Escolha: 11/11/2026. Canvas: https://claude.ai/artifact/3SEQjZ3vmiX3W5TyRHwJVH (artboard C · Noite de jogo). Implementado em 11/11/2026 no tema escuro (chão, tokens, card da Agenda). Não implementado: botão "Reservar quadra" na zona do polegar, rastelo ao puxar para atualizar, entrada lateral da lista ao trocar de dia.

É uma ruptura pedida pelo dono com duas regras de `sistema.md`: "chão liso stone-50" e "saibro só para ação ou agora". Ao implementar, `sistema.md` e `produto.md` são atualizados junto.

## 1. Tese

O app é a quadra de saibro à noite, sob o refletor: o chão é pó de saibro vivo, e tudo o que se lê fica em cards opacos por cima dele.

## 2. Mundo

- **Trava:** Inter 400–800, chão `#140c07`, cards `#1c1917` opacos com borda de 1 px, raio 8 / 14 / 24, alvo de 48 px, nenhum texto abaixo de 12 px, nenhum texto direto sobre grão em movimento sem contraste ≥ 4,5:1 contra o chão base.
- **Cor (papéis):**

| Papel | Valor | Contraste |
|---|---|---|
| Chão | `#140c07` | |
| Superfície (card, trilho) | `#1c1917` | |
| Linha · borda do card em destaque | `#3a3532` · `#57534e` | |
| Texto · 2 · 3 | `#f5f5f4` · `#d6d3d1` · `#a8a29e` | 13:1 no chão (texto 2) · 6,9:1 no card (texto 3) |
| Ação (botão, aba ativa) | `#d4ef3c` amarelo bola, texto `#1c1917` | 13,5:1 |
| Agora | `#f97316` sobre `#2b1a10` | ≥ 6:1 |
| Play | `#4ade80` sobre `#052e16` | |
| Grãos | `#d97a45` `#9c4221` `#f2c4a2` `#c2683c` `#6a2710` | só decoração, atrás dos cards |

- **Material:** textura de saibro gerada em canvas (sem foto), luz radial quente no canto superior direito, linhas de giz a 8–22% de opacidade.
- Saibro deixa de ser a cor de ação: vira o chão e o "agora". A ação é o amarelo bola.

## 3. História

Data grande no topo → o próximo jogo (card com horário de 40 px) → jogos passados rebaixados → "Reservar quadra" na zona do polegar. O pico é o refletor acendendo ao abrir.

## 4. Primeira tela

Sem rolar, em 390 × 844: cabeçalho, data com setas, Dia/Semana/Mês, os dois primeiros cards, o botão "Reservar quadra" (52 px, largura total) e a barra inferior. Ação primária: Reservar quadra.

## 5. Forma

- **Card de jogo:** horário como destaque (40/800 no próximo, 28/800 nos demais, `tabular-nums`), quadra, estado em pílula, nomes, Play, seta. O card inteiro é o alvo.
- **Movimento do chão** (um `<canvas>` atrás do conteúdo, `aria-hidden`):
  1. Refletor acende em 900 ms com uma oscilação curta; depois respira ±3%.
  2. Grãos em três profundidades (longe pequenos e lentos, perto maiores); 12% cintilam dentro do cone de luz.
  3. Vento: campo lento (0,22 px/quadro) e uma rajada ocasional a cada 9–15 s; grão rápido vira risco.
  4. Trocar de dia: rajada na direção da navegação + lista entra do mesmo lado em 280 ms.
  5. Rolar: grãos arrastados no sentido contrário (paralaxe 0,25).
  6. Toque: marca da bola com rastro, nuvem de pó (26 partículas, 0,6–1,4 s) e grãos empurrados num raio de 120 px. A marca fica até o rastelo passar.
  7. Rastelo: a cada 16 s uma faixa desce em 3,2 s, apaga as marcas e deixa sulcos verticais; no app, também ao puxar para atualizar.
- **Movimento reduzido:** um quadro parado, luz acesa, lista só com opacidade. Aba em segundo plano: pausa.
- **Fonte grande / texto longo:** nomes quebram em duas linhas; o horário não encolhe.
- **Tema claro:** a decidir (o canvas tem A · Quadra de dia como candidata).

## 6. Fim

Reserva confirmada devolve à Agenda com o novo card no topo. Teste da memória: "o app que parece uma quadra de saibro iluminada à noite, com o pó se mexendo".

## Demonstração no canvas (não vai para o app)

Selo "STC" no lugar da logo, iniciais no lugar das fotos, estado vazio de Ter 10 e Qui 12, rótulo "Torneios".
