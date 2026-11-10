# Medição em tela — STC

> 2026-11-10 15:51 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P2 | contraste | #vitrine · iphone | borda do campo com 2.41:1 em #_r_0_ | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | contraste | #vitrine · iphone | borda do campo com 2.41:1 em #_r_2_ | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | contraste | #vitrine · iphone | borda do campo com 2.41:1 em #_r_3_ | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | contraste | #vitrine · iphone | borda do campo com 2.41:1 em #_r_4_ | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | robustez | #vitrine · iphone | texto cortado em div.flex.min-h-14 > span.min-w-0.flex-1:nth-of-type(1) > span.block.truncate:nth-of-type(1) ("Gabriela Demo Nome Bem Comprid") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | Hick / Von Restorff | #vitrine · iphone | 5 ações com cor de destaque na primeira dobra ("Reservar", "Excluir", "Enviar comprovante", "Desabilitado") | uma primária; as outras em contorno ou texto | `primarias-demais` |

## Capturas
- #vitrine · iphone · claro: `.fabuloso/design/capturas/_vitrine-iphone.png`
