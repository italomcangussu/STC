# Medição em tela — STC

> 2026-11-10 16:53 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | robustez | #ranking · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #ranking · iphone · escuro | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | contraste | #vitrine · iphone · escuro | 2.77:1 em div.flex.flex-wrap:nth-of-type(1) > button.relative.inline-flex:nth-of-type(4) > span.inline-flex.items-center ("Excluir", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | robustez | #vitrine · iphone | texto cortado em div.flex.min-h-14 > span.min-w-0.flex-1:nth-of-type(1) > span.block.truncate:nth-of-type(1) ("Gabriela Demo Nome Bem Comprid") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | Hick / Von Restorff | #vitrine · iphone | 5 ações com cor de destaque na primeira dobra ("Reservar", "Excluir", "Enviar comprovante", "Desabilitado") | uma primária; as outras em contorno ou texto | `primarias-demais` |
| P2 | robustez | #vitrine · iphone · escuro | texto cortado em div.flex.min-h-14 > span.min-w-0.flex-1:nth-of-type(1) > span.block.truncate:nth-of-type(1) ("Gabriela Demo Nome Bem Comprid") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | Hick / Von Restorff | #vitrine · iphone · escuro | 5 ações com cor de destaque na primeira dobra ("Reservar", "Excluir", "Enviar comprovante", "Desabilitado") | uma primária; as outras em contorno ou texto | `primarias-demais` |
| P3 | contraste | #ranking · iphone | 7 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |
| P3 | contraste | #ranking · iphone · escuro | 7 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |

## Capturas
- #ranking · iphone · claro: `.fabuloso/design/capturas/_ranking-iphone.png`
- #vitrine · iphone · claro: `.fabuloso/design/capturas/_vitrine-iphone.png`
- #ranking · iphone · escuro: `.fabuloso/design/capturas/_ranking-iphone-escuro.png`
- #vitrine · iphone · escuro: `.fabuloso/design/capturas/_vitrine-iphone-escuro.png`
