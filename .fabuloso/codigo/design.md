# Cardápio visual — reserva-sct
> Gerado por `fabuloso.mjs react`; não edite. Toda decisão de interface escolhe daqui: se o valor não está no cardápio, reúse o mais próximo antes de criar um novo.

Bibliotecas: tailwindcss 4 · ícones: lucide-react · toast: sonner
Estilos: index.css

## Tokens (variáveis CSS / @theme)
**color** (12): color-court-dark=#14532d · color-court-green=#166534 · color-court-greenLight=#22c55e · color-court-line=#fafaf9 · color-green-{50…950} · color-orange-{50…950} · color-red-{50…950} · color-saibro-{50…950} · color-stone-{50…950} · color-sunset-end=#C2410C · color-sunset-mid=#EA580C · color-sunset-start=#F97316
**font** (1): font-sans='Inter', sans-serif

## Classes e utilitárias próprias
**classes** (72): animate-ball-pulse · animate-blur-in · animate-fade-in · animate-float · animate-page-enter · animate-popover-enter · animate-scale-in · animate-shimmer · animate-slide-in · animate-spin · animate-spin-slow · animate-zoom-smooth · banner-hero-clay · bg-clay-pattern · bg-sunset-gradient · bracket-breathe · bracket-card-in · bracket-cell-turn · bracket-land-in · bracket-line-draw · bracket-loser-fade · bracket-rail-grow · bracket-slot-pulse · btn-bounce · btn-saibro-primary · btn-saibro-secondary · btn-tactile · card-court · card-kpi · chat-composer-form · chat-overlay-footer · chat-overlay-header · conv-shell · conv-standalone-root · conv-top-bar-floating · custom-scrollbar · delay-100 · delay-150 · delay-200 · delay-300 · delay-400 · delay-50 · delay-500 · delay-75 · divider-net · fixed · form-dot-loss · form-dot-win · grid · hit-44 · hit-target-44 · is-chat-overlay · min-h-safe · overflow-auto · overflow-y-scroll · pb-main-content · pb-navbottom · pb-safe · player-1 · player-2 · pt-safe · scoreboard-num · scrollbar-hide · section-header · selectable · stagger-cascade · tennis-ball · tennis-court-animation · tennis-court-bg · text-badge · text-readable · transition-smooth
**keyframes** (28): ball-rotation · ball-trajectory · ballPulse · blurIn · bracketBreathe · bracketCardIn · bracketCellTurn · bracketLandIn · bracketLineDraw · bracketLoserFade · bracketRailGrow · bracketSlotPulse · fadeIn · float · pageEnter · player1-body-rotate · player1-movement · player1-racket-swing · player2-body-rotate · player2-movement · player2-racket-swing · popoverEnter · scaleIn · shimmer · slideIn · spinSlow · staggerFadeIn · zoomSmooth

## Primitivos de UI (19)
- components/TenisProPlayer/ui/HUD.tsx: HUD
- components/TenisProPlayer/ui/PointOverlay.tsx: PointOverlay
- components/TenisProPlayer/ui/TouchControls.tsx: TouchControls
- components/ui/ConfirmDialog.tsx: ConfirmDialog
- components/ui/ConfirmProvider.tsx: ConfirmProvider
- components/ui/LoadingStates.tsx: InlineSpinner, LoadingButton, LoadingContainer, LoadingOverlay, LoadingSpinner, Shimmer, SkeletonAvatar, SkeletonCard, SkeletonList, SkeletonText
- components/ui/Sheet.tsx: Sheet
- components/ui/TennisCourtAnimation.tsx: TennisCourtAnimation
- components/ui/Tooltip.tsx: InfoTooltip, Tooltip

## Movimento e helpers
**formatadores/máscaras/validadores** (32): formatBRL (lib/finance/money.ts) · formatCountdown (lib/signatures/format.ts) · formatCpf (lib/signatures/cpf.ts) · formatDate (lib/signatures/format.ts) · formatDateTime (lib/signatures/format.ts) · formatDateTimeSeconds (lib/signatures/format.ts) · formatDecimalBRL (lib/finance/money.ts) · formatGeneratedAt (lib/finance/export.ts) · formatMatchDay (lib/resenhaOpenBracketLayout.ts) · formatMessageDayDividerLabel (lib/conversations/messageTimeline.ts) · formatPhone (lib/signatures/receipt.ts) · formatPresenceLabel (lib/conversations/conversationPresenceState.ts) · formatWhatsAppDisplay (lib/conversations/phone.ts) · maskCpf (lib/signatures/cpf.ts) · maskPhone (lib/conversations/phone.ts) · maskPhone (lib/signatures/receipt.ts) · normalizePhoneBr (lib/phoneAuth.ts) · normalizePhoneDigits (lib/phoneAuth.ts) · normalizeReminderDays (lib/finance/memberPendency.ts) · normalizeScoreSlots (lib/resenhaOpenBracketLayout.ts) · normalizeSearch (lib/searchText.ts) · parseBRL (lib/finance/money.ts) · parseDocumentsHash (lib/signatures/routes.ts) · parsePoints (lib/pointRules.ts) · parseReceiptText (lib/finance/receiptText.ts) · parseWhatsAppInlineSegments (lib/conversations/whatsappTextFormatter.tsx) · parseWhatsAppTextBlocks (lib/conversations/whatsappTextFormatter.tsx) · validateAgainstParticipants (lib/championship/formatConfig.ts) · validateBracket (lib/championship/bracket.ts) · validateFormatShape (lib/championship/formatConfig.ts) · validateReceiptFile (lib/finance/receiptFile.ts) · validateStudentForm (lib/students/validateStudentForm.ts)
