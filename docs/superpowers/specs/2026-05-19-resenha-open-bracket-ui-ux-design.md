# Resenha Open Bracket UI/UX Design

## Goal

Evolve the Resenha Open championship bracket from a stacked list of phase cards into a premium tournament-board experience for desktop, mobile, and PWA contexts.

The new UI must make the official 4ª Classe and 5ª Classe brackets easy to inspect, preserve the feeling of a real championship table, and update silently when winners are recorded.

## Approved Direction

Use a refined version of the user's tournament-table reference:

- Navy blue board background.
- Rounded premium SVG connector lines.
- App accent colors, especially saibro/orange for active paths and blue for secondary advancement lines.
- White match cards with strong player names.
- A large tournament-board layout rather than a compressed mobile list.

The visual direction is a premium bracket poster adapted into an interactive product surface.

## Core User Experience

The bracket component renders a board with an internal class switch:

- `4ª Classe`
- `5ª Classe`

The switch stays inside the bracket component at the top of the navy board. It does not replace or merge with the page-level tabs `Partidas`, `Jogos`, and `Chaveamento`.

When a class is selected, only that class bracket is rendered. The selected class, zoom level, and current board position should remain stable when real-time updates arrive.

Clicking or tapping a match does not open a modal. It highlights and centers that match inside the board.

## Desktop Layout

Desktop should use a wider surface than the current `max-w-2xl` stacked view.

The board should show as much of the full bracket as practical:

- 4ª Classe: `Preliminar -> Oitavas -> Quartas -> Semifinal -> Final`
- 5ª Classe: `Oitavas -> Quartas -> Semifinal -> Final`

Each phase is a visual column. Match cards sit at fixed logical positions. Connector lines run from source matches to destination matches.

## Mobile And PWA Layout

Mobile must not squeeze the bracket into a narrow list. The bracket is a large navigable board.

Required behavior:

- Horizontal drag/pan to inspect the bracket.
- Zoom controls inside the component: decrease, current percent, increase, and reset.
- Safe margins using `safe-area-inset-*` and internal padding so content does not collide with iOS/Android PWA chrome, curved screen edges, notch areas, or home indicators.
- A small interaction hint appears inside the board, for example: `Arraste para navegar`.

Pinch zoom can be supported if practical, but visible zoom controls are required because PWA gesture support can vary by browser and device.

## Match Card Anatomy

Each match card has a stable size. It must not expand, collapse, or shift layout when scores appear.

Required card structure:

- Two player rows.
- A compact score area inside the card.
- Three fixed score columns for sets.
- Empty/unplayed set slots render as muted placeholders.
- Winner row gets restrained emphasis.
- Loser row gets reduced contrast after the match is finished.
- W.O. state is supported without changing card dimensions.

The score area uses compact columns inside the card, not a separate band below the names.

## Connector Rules

Connector lines are part of the product quality bar.

Rules:

- Lines are SVG-based.
- Lines use rounded caps and rounded joins.
- Each line exits from the exact vertical center of the whole match card, between the two player rows.
- Lines connect to the center of the destination slot or destination match card.
- Active advancement paths use the app's orange/saibro accent.
- Pending paths use a quieter blue or muted stroke.
- The connector layer must not intercept pointer events.

The connector geometry is data-driven from layout positions rather than manually hardcoded per rendered DOM node.

## Real-Time Behavior

The bracket listens for Supabase Realtime updates to `matches` for the current championship.

When data changes:

- Refetch bracket data.
- Preserve selected class.
- Preserve zoom level.
- Preserve current board position.
- Update silently: no toast, no pulse, no modal.
- If a winner advances, the destination slot updates with the winner name.
- The associated advancement line changes to active styling.

This is intentionally calm. The bracket should feel live without feeling noisy.

## Data And Fallback

The board consumes the existing `fetchBracket()` output.

The UI must render when either backend matches or the official local Resenha Open fallback provides the bracket. It should not depend on a draw action being completed.

The empty state `Sorteio ainda não realizado` should only appear when there are no backend matches and no local official bracket fallback.

## Component Plan

Keep the implementation focused around `ResenhaOpenBracketView`, but split the UI into dedicated subcomponents.

Component boundaries:

- `ResenhaOpenBracketView`: loads data, owns selected class, subscribes to realtime, passes bracket data down.
- `BracketClassSwitch`: renders the 4ª/5ª Classe switch inside the board.
- `TournamentBracketBoard`: owns pan, zoom, selected match centering, safe-area spacing, and board dimensions.
- `BracketMatchCard`: renders players, score columns, winner/loser states, W.O., and pending state.
- `BracketConnectorLayer`: renders SVG connector paths.
- `ZoomControls`: renders zoom controls for mouse/touch/PWA use.

Component names may vary during implementation, but these responsibilities must remain separated.

## Interaction Details

Class switching:

- Switching class changes the board data and resets pan to the left/start of the bracket.
- Zoom is preserved across class switches.

Match selection:

- Tap/click highlights the match.
- The board scrolls/pans to center the selected match.
- A second tap on the same match clears selection.

Zoom:

- Minimum zoom must keep cards readable.
- Maximum zoom must not create unusable scrolling.
- Default zoom should fit comfortably on desktop and show a usable start position on mobile.

## Accessibility

The board must remain navigable and understandable without relying only on lines.

Requirements:

- Match cards are buttons or focusable elements.
- Selected class switch uses accessible button/segmented-control semantics.
- Match cards include phase and match number in accessible text.
- Winner state is conveyed with text or aria label, not color alone.
- Score values are readable by screen readers.
- Keyboard focus styling is visible.

## Testing And Verification

Required verification:

- Unit tests for class grouping and fallback behavior.
- Unit tests for score slot normalization to three set columns.
- Unit tests for connector calculation, especially center-of-match source points.
- Build verification.
- Playwright validation using login phone `88999990507`.
- Desktop screenshot of `Campeonatos -> Resenha Open 2026 -> Chaveamento`.
- Mobile/PWA-sized screenshot of the bracket board.
- Console check with no relevant runtime errors.

The rendered UI must be tested in browser because this is primarily a visual and interaction change.

## Out Of Scope

This design does not include:

- New result-entry workflows.
- Opening match detail modals from the bracket.
- Toast notifications for bracket updates.
- Reworking the main `Partidas/Jogos/Chaveamento` tab system.
- Changing tournament rules, draw generation, or scoring logic.

## Implementation Notes

The implementation should prefer CSS transforms for board zoom and scroll/pan over scaling individual cards independently.

Connector paths should be derived from a layout model, for example phase columns, match rows, card dimensions, and source/destination relationships. This keeps the visuals stable across desktop and mobile.

Pinch zoom is progressive enhancement. The first implementation can rely on explicit zoom buttons and drag scrolling only.
