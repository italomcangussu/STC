# Capacidades — STC (perfil nuvem)
> Gerado pela skill fabuloso. Atualizado só quando skills são instaladas/removidas.

## Gatilhos obrigatórios
- UI/layout → `refatorar-ui` AUSENTE; sem skill de design nesta nuvem (`theme-factory` só p/ artefatos). Seguir `DESIGN_SYSTEM.md` e `MODAL_PATTERN.md`.
- Qualidade/testes → `uncle-bob` AUSENTE; alternativas: `simplify`, `code-review`, `security-review`.
- Performance → `performance-profile` AUSENTE.
- Banco → `supabase` AUSENTE como skill; usar conector MCP Supabase (`execute_sql`, `get_advisors`) + `references/regras-banco.md`.
- iPhone → `hig` AUSENTE (app é PWA; sem pasta `ios/`).
- Localizar código → agentmap (CLI).

## Por área
### Front-end/design
- `simplify`, `code-review` — revisão de diff
### Banco de dados
- conector MCP Supabase — SQL, migrations, advisors, logs
- migrations do financeiro são testadas offline em PGlite (`__tests__/finance/sql/`), sem tocar o remoto
### Qualidade de código
- `code-review`, `simplify`, `security-review`
### Outras (raramente relevantes)
- docs, docx, pdf, pptx, xlsx, brand-guidelines, theme-factory, morning, skill-creator, import-memory, google-workspace
