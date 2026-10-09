# Mapa React — reserva-sct
> Gerado por `fabuloso.mjs react`; não edite. Detalhe por tela em `telas/`. Cardápio visual em `design.md`. Imports e símbolos exatos → agentmap.

Stack: React 19 · Vite · supabase-js · tailwindcss 4 · ícones: lucide-react · toast: sonner
Entrada: — · Rotas declaradas em: —

## Rotas (0)
Dados: s=select i=insert u=update U=upsert d=delete.
_nenhum_

## Providers e contexts (4)
| Context | Arquivo | Provider | Montado em | Hook de acesso | Consumidores |
|---|---|---|---|---|---|
| AdminEmbedContext | components/admin/AdminEmbedContext.tsx | AdminEmbedProvider | components/AdminPanel.tsx | useAdminEmbedded | 8 |
| AuthContext | contexts/AuthContext.tsx | AuthProvider | App.tsx | useAuth | 7 |
| ConfirmContext | hooks/useConfirm.ts | ConfirmProvider | App.tsx | useConfirm | 28 |
| Ctx | components/finance/FinanceContext.tsx | FinanceProvider | components/finance/FinanceHub.tsx | useFinance | 18 |

## Stores (0)
_nenhum_

## Hooks próprios (34)
| Hook | Arquivo | Dados | Usado por |
|---|---|---|---|
| useConfirm | hooks/useConfirm.ts | — | 27 |
| useAsync | components/finance/hooks.ts | — | 26 |
| useToday | components/finance/hooks.ts | — | 18 |
| useFinance | components/finance/FinanceContext.tsx | — | 17 |
| useRequestKey | components/finance/hooks.ts | — | 17 |
| useAction | components/finance/hooks.ts | — | 8 |
| useAdminEmbedded | components/admin/AdminEmbedContext.tsx | — | 7 |
| useAuth | contexts/AuthContext.tsx | — | 6 |
| useLiveRefresh | hooks/useLiveRefresh.ts | — | 4 |
| useAdminPending | components/admin/useAdminPending.ts | — | 1 |
| useAgendaRealtime | hooks/useAgendaRealtime.ts | — | 1 |
| useAI | components/TenisProPlayer/engine/useAI.ts | — | 1 |
| useBallPhysics | components/TenisProPlayer/engine/useBallPhysics.ts | — | 1 |
| useChargesList | components/finance/tabs/members/useChargesList.ts | — | 1 |
| useChatOverlay | components/conversations/useChatOverlay.ts | — | 1 |
| useOrientation | components/TenisProPlayer/engine/useOrientation.ts | — | 1 |
| usePendencies | components/finance/tabs/pendencies/usePendencies.ts | fin_member_charges(s) | 1 |
| usePendingSignatures | lib/signatures/usePendingSignatures.ts | — | 1 |
| usePlayerInput | components/TenisProPlayer/engine/usePlayerInput.ts | — | 1 |
| useReceiptDraft | components/finance/member/useReceiptDraft.ts | — | 1 |
| useReceiptHints | components/finance/member/useReceiptDraft.ts | — | 1 |
| useScoring | components/TenisProPlayer/engine/useScoring.ts | — | 1 |
| useSounds | components/TenisProPlayer/engine/useSounds.ts | — | 1 |
| useVersionCheck | hooks/useVersionCheck.ts | — | 1 |
| useChallenges | hooks/useChallenges.ts | challenges(s,i,u) head_to_head_points(s) matches(s) profiles(s) · rpc get_ranking_cycle_start | 0 |
| useLatest | components/signatures/PdfReader.tsx | — | 0 |
| useMediaQuery | components/conversations/useChatOverlay.ts | — | 0 |
| useMemberFinance | components/finance/MemberFinance.tsx | fin_member_charges(s) fin_member_credits(s) fin_receipt_charges(s) fin_receipt_submissions(s) | 0 |
| useNewPlanPreview | components/finance/tabs/members/NewPlanSheet.tsx | — | 0 |
| useRealtimeSubscription | hooks/useRealtimeSubscription.ts | — | 0 |
| useRealtimeSubscriptions | hooks/useRealtimeSubscription.ts | — | 0 |
| useReservations | hooks/useReservations.ts | courts(s) profiles(s) reservations(s,i,u) | 0 |
| useRulesSheet | components/finance/tabs/PendenciesTab.tsx | — | 0 |
| useStandardModal | components/StandardModal.tsx | — | 0 |

## Componentes compartilhados (25 mais usados)
| Componente | Arquivo | Usado por |
|---|---|---|
| Spinner | components/finance/ui.tsx | 28 |
| Notice | components/finance/ui.tsx | 23 |
| Badge | components/finance/ui.tsx | 19 |
| Card | components/finance/ui.tsx | 19 |
| Field | components/finance/ui.tsx | 19 |
| Sheet (ui) | components/ui/Sheet.tsx | 19 |
| Empty | components/finance/ui.tsx | 18 |
| StandardModal | components/StandardModal.tsx | 15 |
| ErrorBlock | components/finance/ui.tsx | 14 |
| Row | components/finance/ui.tsx | 13 |
| MoneyInput | components/finance/ui.tsx | 12 |
| SectionTabs | components/finance/ui.tsx | 11 |
| Notice | components/signatures/ui.tsx | 7 |
| Button | components/conversations/ui.tsx | 6 |
| InlineAlert | components/conversations/ui.tsx | 6 |
| Spinner | components/signatures/ui.tsx | 6 |
| ChargeStatusBadge | components/finance/ui.tsx | 5 |
| ExportButtons | components/finance/ui.tsx | 5 |
| AccountSelect | components/finance/fields.tsx | 4 |
| AdminPageHeader | components/admin/ui.tsx | 4 |
| AdminSearch | components/admin/ui.tsx | 4 |
| Badge | components/signatures/ui.tsx | 4 |
| Money | components/finance/ui.tsx | 4 |
| PeriodBar | components/finance/ui.tsx | 4 |
| ActionPanel | components/finance/ActionPanel.tsx | 3 |

## Alertas (47)
- Acesso a dados direto no componente: `PublicChampionshipEntry` (App.tsx:66) chama championships; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AnnouncementPopup` (App.tsx:114) chama announcements; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminLogin` (components/AdminLogin.tsx:32) chama profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminMatchCreator` (components/AdminMatchCreator.tsx:131) chama reservations, matches, challenges; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `NewChallengeModal` (components/AdminPanel.tsx:79) chama reservations; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ReservasTab` (components/AdminPanel.tsx:270) chama reservations, courts, profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `DesafiosTab` (components/AdminPanel.tsx:433) chama challenges, profiles, courts, matches, reservations; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AnunciosTab` (components/AdminPanel.tsx:766) chama announcements; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `SociosTab` (components/AdminPanel.tsx:1004) chama profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AcessosTab` (components/AdminPanel.tsx:1137) chama access_requests, profiles, admin_audit_logs; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `LancamentosTab` (components/AdminPanel.tsx:1550) chama point_history, profiles, ranking_reset_events, courts, admin_reset_ranking_full; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminProfessors` (components/AdminProfessors.tsx:118) chama professors, non_socio_students; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminProtect` (components/AdminProtect.tsx:23) chama profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminReports` (components/AdminReports.tsx:78) chama reservations, profiles, consumptions, challenges, matches, courts; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminRules` (components/AdminRules.tsx:112) chama point_rules; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminStudents` (components/AdminStudents.tsx:79) chama non_socio_students, student_profiles, professors, profiles, set_student_level, student_level_history, student_payments; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AdminUserEditor` (components/AdminUserEditor.tsx:125) chama profiles, point_history; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `Agenda` (components/Agenda.tsx:1229) chama profiles, courts, professors, student_profiles, non_socio_students, challenges, reservations, matches; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AddReservationModal` (components/Agenda.tsx:2333) chama student_profiles, non_socio_students; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AthleteProfile` (components/Athletes.tsx:67) chama matches, reservations, courts, point_history, championship_series, get_user_h2h_points, challenges; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `Athletes` (components/Athletes.tsx:646) chama profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ChallengeNotificationPopup` (components/ChallengeNotificationPopup.tsx:28) chama challenges, courts, reservations; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `CreateChallengeModal` (components/Challenges.tsx:72) chama courts, reservations; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ChallengeResultsModal` (components/Challenges.tsx:418) chama matches, profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ChallengesView` (components/Challenges.tsx:509) chama challenges, matches, reservations; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ChampionshipAdmin` (components/ChampionshipAdmin.tsx:204) chama championships, profiles, championship_registrations, championship_rounds, championship_groups, championship_admin_audit_logs, finish_championship, apply_championship_edition_points, revert_championship_edition_points, matches; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ChampionshipCreator` (components/ChampionshipCreator.tsx:94) chama championships, profiles, championship_rounds, matches; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ChampionshipInProgress` (components/ChampionshipInProgress.tsx:120) chama courts, championship_rounds, championship_groups, championship_group_members, championship_registrations, profiles, matches, championship_admin_audit_logs; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `Championships` (components/Championships.tsx:140) chama championships, profiles, courts, championship_registrations, championship_rounds, matches, championship_groups, championship_group_members, championship_admin_audit_logs; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `Dashboard` (components/Dashboard.tsx:41) chama courts, profiles, reservations; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `EditProfileModal` (components/EditProfileModal.tsx:79) chama profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `FinanceiroAdmin` (components/FinanceiroAdmin.tsx:59) chama reservations, non_socio_students, student_payments; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `GroupDrawPage` (components/GroupDrawPage.tsx:84) chama championships, championship_registrations, profiles, championship_groups, championship_group_members; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `Klanches` (components/Klanches.tsx:99) chama products, consumptions, profiles, reservations, courts; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `Layout` (components/Layout.tsx:76) chama championships; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `LiveScoreboard` (components/LiveScoreboard.tsx:157) chama matches; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `MatchGenerationModal` (components/MatchGenerationModal.tsx:108) chama matches; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `OnboardingModal` (components/OnboardingModal.tsx:63) chama profiles; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ProfessorProfile` (components/ProfessorProfile.tsx:182) chama professors, profiles, non_socio_students, student_profiles, reservations, courts, set_student_level, student_level_history, student_payments; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `PublicChampionshipPage` (components/PublicChampionshipPage.tsx:57) chama championships, championship_rounds, championship_groups, championship_group_members, championship_registrations, profiles, matches; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `ResenhaOpenBracketView` (components/ResenhaOpenBracketView.tsx:26) chama championships; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `SuperSet` (components/SuperSet.tsx:39) chama profiles, reservations, matches; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `PhasePointsEditor` (components/admin/PhasePointsEditor.tsx:37) chama championship_phase_points; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `CreatorRegistration` (components/creator/CreatorRegistration.tsx:121) chama profiles, championship_registrations; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `CreatorSetup` (components/creator/CreatorSetup.tsx:21) chama championship_series; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `DocumentDetail` (components/signatures/admin/DocumentDetail.tsx:137) chama sig_documents; o padrão do projeto é passar por hook/serviço
- Acesso a dados direto no componente: `AuthProvider` (contexts/AuthContext.tsx:68) chama profiles, admin_record_user_access, access_requests; o padrão do projeto é passar por hook/serviço
