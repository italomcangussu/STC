# Capacidades — STC (perfil nuvem)
> Gerado pela skill fabuloso. Atualizado só quando skills são instaladas/removidas.

## Gatilhos obrigatórios
- UI/layout → `refatorar-ui` AUSENTE; alternativas: `accessibility-review`, `design-critique`, `ux-copy`. Seguir `DESIGN_SYSTEM.md`.
- Qualidade/testes → `uncle-bob` AUSENTE; alternativas: `testing-strategy`, `debug`, `simplify`, `code-review`.
- Performance → `performance-profile` AUSENTE.
- Banco → `supabase` AUSENTE como skill; usar conector MCP Supabase (`execute_sql`, `get_advisors`) + `references/regras-banco.md`.
- iPhone → `hig` AUSENTE (app é PWA; sem pasta `ios/`).
- Localizar código → agentmap (CLI).

## Por área
### Front-end/design
- `simplify`, `code-review` — revisão de diff; `accessibility-review`, `design-critique`, `ux-copy`
### Banco de dados
- conector MCP Supabase — SQL, migrations, advisors, logs; `sql-queries`/`write-query` (apoio a consultas)
- migrations do financeiro são testadas offline em PGlite (`__tests__/finance/sql/`), sem tocar o remoto
### Qualidade de código
- `code-review`, `simplify`, `testing-strategy`, `system-design`/`architecture` (desenho)
### Outras (raramente relevantes)
- docs, docx, pdf, pptx, xlsx, brand-guidelines, morning, skill-creator, import-memory, google-workspace
