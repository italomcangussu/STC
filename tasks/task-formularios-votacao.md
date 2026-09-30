# Plano de Implementação: Módulo de Formulários & Votação ao Vivo (STC Play)

## 📌 Visão Geral
Criar o módulo completo de **Formulários e Urna de Votação com Placar ao Vivo** para o Sobral Tênis Clube (STC), composto por:
1. **Modelagem de Dados & Urna Cega (Supabase):** Tabelas `club_forms`, `club_form_questions`, `club_form_options`, `club_form_voter_receipts` e `club_form_responses` com RLS, índices e publicação Realtime.
2. **Painel Administrativo (`AdminForms.tsx`):** Adicionado ao `AdminPanel.tsx` com construtor de formulários (título, subtítulo, regras de submissão, perguntas de múltipla escolha ou texto aberto, opções de votação secreta e placar ao vivo), listagem, métricas de respostas, link e QR code para compartilhamento.
3. **Página Pública & Urna do Sócio (`PublicFormPage.tsx`):** Rota pública `/votacao/:slug` e `?form=:slug` com suporte a autenticação do sócio, validação de voto único, experiência mobile com hit targets 44px, feedback imediato e placar em tempo real via canais Supabase Realtime.
4. **Navegação & Atalhos:** Nova aba "Formulários" no `AdminPanel`, rota pública em `lib/publicRoutes.ts` e card/atalho para sócios responderem às votações ativas.

---

## 🛠️ Arquitetura das Tabelas (SQL)

### 1. `club_forms`
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `title` TEXT NOT NULL
- `description` TEXT
- `slug` TEXT UNIQUE NOT NULL
- `is_active` BOOLEAN NOT NULL DEFAULT true
- `is_secret_vote` BOOLEAN NOT NULL DEFAULT false
- `requires_auth` BOOLEAN NOT NULL DEFAULT true
- `allow_multiple_submissions` BOOLEAN NOT NULL DEFAULT false
- `show_live_results` BOOLEAN NOT NULL DEFAULT true
- `starts_at` TIMESTAMPTZ
- `expires_at` TIMESTAMPTZ
- `created_by` UUID REFERENCES profiles(id)
- `created_at` TIMESTAMPTZ DEFAULT now()
- `updated_at` TIMESTAMPTZ DEFAULT now()

### 2. `club_form_questions`
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `form_id` UUID NOT NULL REFERENCES club_forms(id) ON DELETE CASCADE
- `title` TEXT NOT NULL
- `description` TEXT
- `question_type` TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'open_text'))
- `is_required` BOOLEAN NOT NULL DEFAULT true
- `display_order` INTEGER NOT NULL DEFAULT 0
- `created_at` TIMESTAMPTZ DEFAULT now()

### 3. `club_form_options`
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `question_id` UUID NOT NULL REFERENCES club_form_questions(id) ON DELETE CASCADE
- `label` TEXT NOT NULL
- `display_order` INTEGER NOT NULL DEFAULT 0
- `created_at` TIMESTAMPTZ DEFAULT now()

### 4. `club_form_voter_receipts` (Garante 1 voto por sócio sem revelar autoria em voto secreto)
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `form_id` UUID NOT NULL REFERENCES club_forms(id) ON DELETE CASCADE
- `user_id` UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
- `created_at` TIMESTAMPTZ DEFAULT now()
- UNIQUE (form_id, user_id)

### 5. `club_form_responses` (Respostas computadas)
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `form_id` UUID NOT NULL REFERENCES club_forms(id) ON DELETE CASCADE
- `question_id` UUID NOT NULL REFERENCES club_form_questions(id) ON DELETE CASCADE
- `option_id` UUID REFERENCES club_form_options(id) ON DELETE CASCADE
- `text_response` TEXT
- `user_id` UUID REFERENCES profiles(id) ON DELETE SET NULL -- NULL se is_secret_vote = true
- `created_at` TIMESTAMPTZ DEFAULT now()

---

## 🚀 Fases de Execução

- [ ] **Fase 1: Migração SQL & Banco de Dados**
  - Criar `supabase/migrations/20260930120000_create_club_forms_and_voting.sql`
  - Criar tabelas, índices e triggers de updated_at
  - Configurar RLS e publicação Realtime em `club_form_responses`
  - Criar função RPC segura para submissão atômica de votos/respostas com validação de urna cega

- [ ] **Fase 2: Tipos & Serviços TypeScript**
  - Adicionar tipos em `types.ts` (`ClubForm`, `FormQuestion`, `FormOption`, `FormResponse`, etc.)
  - Criar `lib/formsService.ts` com funções de CRUD, contagem de votos agregados e subscription de realtime

- [ ] **Fase 3: Módulo Administrativo (`AdminForms.tsx`)**
  - Construtor visual de formulários (Título, subtítulo, slug automático, toggles de regras)
  - Gerenciador de perguntas (Múltipla escolha / Texto aberto / Obrigatória / Adicionar opções)
  - Listagem de formulários com status, contagem de votos, botões de ação (Copiar Link, QR Code, Pausar/Ativar, Ver Apuração, Excluir)
  - Modal de Resultados/Apuração detalhada para o admin
  - Integrar aba `formularios` em `components/AdminPanel.tsx`

- [ ] **Fase 4: Rota Pública & Urna do Sócio (`PublicFormPage.tsx`)**
  - Atualizar `lib/publicRoutes.ts` e `App.tsx` para interceptar rotas `/votacao/:slug` e `?form=:slug`
  - Componente de Urna/Formulário seguindo `/refatorar-ui` (Design System STC, Saibro, 44px touch targets, Dark mode, validação clara)
  - Se formulário exige sócio: integração com `useAuth` e tela rápida de login inline se visitante externo
  - Verificação de recibo: se já votou e `allow_multiple_submissions = false`, exibe confirmação e leva direto ao placar
  - Painel de Placar ao Vivo com barras de progresso animadas e escuta Realtime do Supabase

- [ ] **Fase 5: Atalho no App para Sócios & Testes**
  - Exibir banner/card de votação ativa para sócios logados
  - Testes unitários para `formsService` e renderização de formulários
  - Validação via `npm run test` e build `npm run build`
