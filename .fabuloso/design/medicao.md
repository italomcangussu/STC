# Medição em tela — STC

> 2026-11-10 16:25 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | robustez | #agenda · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #ranking · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #desafios · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #campeonatos · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #meu-financeiro · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #agenda · android | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #ranking · android | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #desafios · android | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #campeonatos · android | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #meu-financeiro · android | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P2 | robustez | #agenda · iphone | texto cortado em div:nth-of-type(2) > div.space-y-4.animate-in > h3.sr-only ("Terça, 10") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | robustez | #vitrine · iphone | texto cortado em div.flex.min-h-14 > span.min-w-0.flex-1:nth-of-type(1) > span.block.truncate:nth-of-type(1) ("Gabriela Demo Nome Bem Comprid") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | Hick / Von Restorff | #vitrine · iphone | 5 ações com cor de destaque na primeira dobra ("Reservar", "Excluir", "Enviar comprovante", "Desabilitado") | uma primária; as outras em contorno ou texto | `primarias-demais` |
| P2 | robustez | #agenda · android | texto cortado em div:nth-of-type(2) > div.space-y-4.animate-in > h3.sr-only ("Terça, 10") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | robustez | #vitrine · android | texto cortado em div.flex.min-h-14 > span.min-w-0.flex-1:nth-of-type(1) > span.block.truncate:nth-of-type(1) ("Gabriela Demo Nome Bem Comprid") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | Hick / Von Restorff | #vitrine · android | 5 ações com cor de destaque na primeira dobra ("Reservar", "Excluir", "Enviar comprovante", "Desabilitado") | uma primária; as outras em contorno ou texto | `primarias-demais` |
| P3 | Doherty | #agenda · iphone | primeiro conteúdo em 1212 ms (servidor de dev: confirme no build de produção) | skeleton imediato, código dividido por rota, imagens com tamanho e lazy | `vitais` |
| P3 | acessibilidade | #meu-financeiro · iphone | títulos pulam nível: h1 → h3 ("Meus comprovantes") | siga a ordem (h1 → h2 → h3); o tamanho visual se ajusta por classe, não pelo nível | `titulo-pula-nivel` |
| P3 | acessibilidade | #meu-financeiro · android | títulos pulam nível: h1 → h3 ("Meus comprovantes") | siga a ordem (h1 → h2 → h3); o tamanho visual se ajusta por classe, não pelo nível | `titulo-pula-nivel` |
| P3 | contraste | #agenda · iphone | 9 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |
| P3 | contraste | #ranking · iphone | 7 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |
| P3 | contraste | #meu-financeiro · iphone | 4 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |
| P3 | contraste | #agenda · android | 9 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |
| P3 | contraste | #ranking · android | 7 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |
| P3 | contraste | #meu-financeiro · android | 4 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |

## Capturas
- #agenda · iphone · claro: `.fabuloso/design/capturas/_agenda-iphone.png`
- #ranking · iphone · claro: `.fabuloso/design/capturas/_ranking-iphone.png`
- #desafios · iphone · claro: `.fabuloso/design/capturas/_desafios-iphone.png`
- #campeonatos · iphone · claro: `.fabuloso/design/capturas/_campeonatos-iphone.png`
- #meu-financeiro · iphone · claro: `.fabuloso/design/capturas/_meu-financeiro-iphone.png`
- #vitrine · iphone · claro: `.fabuloso/design/capturas/_vitrine-iphone.png`
- #agenda · android · claro: `.fabuloso/design/capturas/_agenda-android.png`
- #ranking · android · claro: `.fabuloso/design/capturas/_ranking-android.png`
- #desafios · android · claro: `.fabuloso/design/capturas/_desafios-android.png`
- #campeonatos · android · claro: `.fabuloso/design/capturas/_campeonatos-android.png`
- #meu-financeiro · android · claro: `.fabuloso/design/capturas/_meu-financeiro-android.png`
- #vitrine · android · claro: `.fabuloso/design/capturas/_vitrine-android.png`
