# Capacidades — STC (perfil local)
> Gerado pela skill fabuloso. Atualizado só quando skills são instaladas/removidas.

## Gatilhos obrigatórios
- UI/layout/componente novo → `refatorar-ui` (tokens do projeto: Tailwind v4, HIG/iOS-26, framer-motion); depois `impeccable` para auditoria visual. Seguir `DESIGN_SYSTEM.md` e `MODAL_PATTERN.md`.
- iPhone / PWA instalada / safe-area / teclado → `hig` antes de decidir; `pwa-design-debug` para faixa morta embaixo e teclado; `simulador-ios` para conferir no simulador.
- Qualidade/testes/refatoração → `uncle-bob`; `test-driven-development` ao criar regra nova; `code-review` e `simplify` no diff.
- Bug/teste quebrado → `systematic-debugging` antes de propor correção.
- Banco → `supabase` + `supabase-postgres-best-practices`; MCP Supabase (`execute_sql`, `get_advisors`, `list_migrations`); regras em `references/regras-banco.md` da skill fabuloso. Migrations offline em PGlite (`__tests__/*/sql/`).
- Chat/WhatsApp (Conversas, UazAPI, avisos de assinatura) → `chat-best-practices`, `uazapi`.
- Antes de afirmar "pronto" → `verification-before-completion`.
- Localizar código → agentmap (CLI) ou `arquitetura.md`.

## Por área
### Front-end/design
- `refatorar-ui`, `impeccable`, `frontend-design`, `design-taste-frontend`, `high-end-visual-design`, `dark-mode-design-expert`, `hig`, `pwa-design-debug`, `simulador-ios`
### Banco de dados
- `supabase`, `supabase-postgres-best-practices`, MCP Supabase (o conector `mcp__supabase__*` pode pedir token; o do claude.ai `mcp__6a0fd75e…` funcionou em 2026-10-07)
### Qualidade de código
- `uncle-bob`, `code-review`, `simplify`, `security-review`, `performance-profiler`, `test-driven-development`
### Processo
- `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `using-git-worktrees`, `finishing-a-development-branch`, `requesting-code-review`, `receiving-code-review`
### Engenharia (plugin `engineering`)
- `engineering:debug`, `engineering:testing-strategy`, `engineering:architecture`, `engineering:deploy-checklist`, `engineering:incident-response`, `engineering:documentation`
### Outras (raramente relevantes)
- docx, pdf, pptx, xlsx, humanizer, brand-guidelines, schedule/loop; plugins `data:*`, `marketing:*`, `sales:*`, `legal:*`, `finance:*`, `n8n-*` (não relevantes para o código do STC, exceto o PDF do comprovante da fase 5 de assinaturas, que usa pdfjs/jsPDF no próprio app)
