# Medição em tela — STC

> 2026-11-10 17:09 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | robustez | #agenda · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #desafios · iphone | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #agenda · iphone · escuro | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #desafios · iphone · escuro | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #agenda · android | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #desafios · android | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #agenda · android · escuro | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P1 | robustez | #desafios · android · escuro | imagem não carregou: button.flex.min-h-12 > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P2 | robustez | #agenda · iphone | texto cortado em div:nth-of-type(2) > div.space-y-4.animate-in > h3.sr-only ("Terça, 10") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | robustez | #agenda · iphone · escuro | texto cortado em div:nth-of-type(2) > div.space-y-4.animate-in > h3.sr-only ("Terça, 10") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | robustez | #agenda · android | texto cortado em div:nth-of-type(2) > div.space-y-4.animate-in > h3.sr-only ("Terça, 10") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | robustez | #agenda · android · escuro | texto cortado em div:nth-of-type(2) > div.space-y-4.animate-in > h3.sr-only ("Terça, 10") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |

## Capturas
- #agenda · iphone · claro: `.fabuloso/design/capturas/_agenda-iphone.png`
- #desafios · iphone · claro: `.fabuloso/design/capturas/_desafios-iphone.png`
- #agenda · iphone · escuro: `.fabuloso/design/capturas/_agenda-iphone-escuro.png`
- #desafios · iphone · escuro: `.fabuloso/design/capturas/_desafios-iphone-escuro.png`
- #agenda · android · claro: `.fabuloso/design/capturas/_agenda-android.png`
- #desafios · android · claro: `.fabuloso/design/capturas/_desafios-android.png`
- #agenda · android · escuro: `.fabuloso/design/capturas/_agenda-android-escuro.png`
- #desafios · android · escuro: `.fabuloso/design/capturas/_desafios-android-escuro.png`
