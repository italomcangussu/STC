# Medição em tela — STC

> 2026-11-10 16:11 · http://localhost:3000/design-lab.html · Google Chrome. Evidência: emulação em Chromium (sem recorte do iPhone, sem zoom do Safari, sem gesto do sistema).

| P | Lei | Onde | Problema | Correção | Regra |
|---|---|---|---|---|---|
| P1 | contraste | #agenda · iphone | 2.51:1 em div.flex.items-center:nth-of-type(1) > div.flex.flex-col > span.text-meta.text-stone-400 ("Clube de Tênis", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | contraste | #agenda · iphone | 2.52:1 em div.flex.justify-end:nth-of-type(2) > div.flex.items-center > span.text-meta.uppercase ("Ver Canceladas", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | contraste | #agenda · iphone | 2.52:1 em div.absolute.bottom-0 > button.flex.flex-col:nth-of-type(2) > span.text-meta.mt-1 ("Ranking", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | contraste | #agenda · iphone | 2.52:1 em div.absolute.bottom-0 > button.flex.flex-col:nth-of-type(3) > span.text-meta.mt-1 ("Desafios", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | contraste | #agenda · iphone | 2.52:1 em div.absolute.bottom-0 > button.flex.flex-col:nth-of-type(4) > span.text-meta.mt-1 ("SuperSet", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P1 | robustez | #agenda · iphone | imagem não carregou: button.flex.items-center > div.relative > img.w-7.h-7 | confira o caminho; dê um fundo e um alt para a falha não virar buraco | `imagem-quebrada` |
| P2 | Fitts | #agenda · iphone | alvo de 68×38 em header.flex-none.backdrop-blur-xl > div.flex.items-center:nth-of-type(2) > button.flex.items-center ("Menu Principal") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 42×34 em div.flex.flex-col:nth-of-type(1) > div.flex.justify-between:nth-of-type(1) > button.bg-saibro-600.text-white | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 107×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(1) ("Dia") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 107×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 107×32 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês") | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | Fitts | #agenda · iphone | alvo de 40×40 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 44×44; a área de toque pode ser maior que o desenho | `alvo-pequeno` |
| P2 | contraste | #agenda · iphone | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(2) ("Semana", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · iphone | 4.4:1 em div.flex.flex-col:nth-of-type(1) > div.bg-stone-100.p-1:nth-of-type(2) > button.flex-1.py-1.5:nth-of-type(3) ("Mês", 14px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · iphone | 3.43:1 em div.absolute.bottom-0 > button.flex.flex-col:nth-of-type(1) > span.text-meta.mt-1 ("Agenda", 12px) | mínimo 4.5:1: escureça o texto ou clareie o fundo um degrau | `contraste-baixo` |
| P2 | contraste | #agenda · iphone | +1 textos com contraste baixo | ver captura | `contraste-baixo` |
| P2 | contraste | #agenda · iphone | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(1) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | contraste | #agenda · iphone | ícone com 2.41:1 em div.flex.flex-col:nth-of-type(3) > div.flex.items-center:nth-of-type(1) > button.w-10.h-10:nth-of-type(2) | mínimo 3:1 contra o fundo (borda de campo, ícone sem texto ao lado) | `contraste-nao-texto` |
| P2 | robustez | #vitrine · iphone | texto cortado em div.flex.min-h-14 > span.min-w-0.flex-1:nth-of-type(1) > span.block.truncate:nth-of-type(1) ("Gabriela Demo Nome Bem Comprid") | deixe quebrar em duas linhas; se o corte é intencional (nome longo numa lista), mostre o texto inteiro no detalhe ou no title | `texto-cortado` |
| P2 | Hick / Von Restorff | #vitrine · iphone | 5 ações com cor de destaque na primeira dobra ("Reservar", "Excluir", "Enviar comprovante", "Desabilitado") | uma primária; as outras em contorno ou texto | `primarias-demais` |
| P3 | Doherty | #agenda · iphone | primeiro conteúdo em 1660 ms (servidor de dev: confirme no build de produção) | skeleton imediato, código dividido por rota, imagens com tamanho e lazy | `vitais` |
| P3 | contraste | #agenda · iphone | 9 texto(s) sobre imagem/gradiente ou cor ilegível: contraste não medido | confira na captura | `contraste-baixo` |

## Capturas
- #agenda · iphone · claro: `.fabuloso/design/capturas/_agenda-iphone.png`
- #vitrine · iphone · claro: `.fabuloso/design/capturas/_vitrine-iphone.png`
