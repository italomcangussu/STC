# Plano de Implementação: Mensageiro Nativo / Conversas Fullscreen + Push Notifications HIG

## Contexto e Objetivos
Evoluir o submenu "Conversas" do painel administrativo do STC Play para:
1. **Nova Aba Dedicada (`/conversas`)**:
   - Funcionar como um mensageiro nativo estilo WhatsApp Web / Telegram Web no Desktop (tela cheia, 2 colunas, lista de chats à esquerda e conversa ativa à direita).
   - No Mobile / PWA: comportamento de app nativo (lista de conversas inicial, toque para entrar na conversa com botão voltar estilo iOS, composer colado no teclado virtual).
   - Atalho claro no painel administrativo para abrir em nova aba.
   - Navegação integrada e discreta para acessar as capacidades complementares (Automações, IA e Canal de WhatsApp).
2. **Correção e Estabilidade de Teclado PWA Mobile (`pwa-design-debug`)**:
   - Respeitar viewport visual (`window.visualViewport`) com altura dinâmica e sincronização no scroll/resize.
   - Implementar a guarda de liberação no evento `focusout` para contornar o bug do iOS 26 onde `visualViewport.offsetTop` não zera após o fechamento do teclado.
   - Preservar safe area insets sem faixas cinzas mortas na base.
3. **Notificações Push para Administradores (Apple HIG + Supabase + VAPID)**:
   - Configurar `VITE_VAPID_PUBLIC_KEY` no `.env.local` e carregar de forma segura no app sem expor segredos.
   - Criar componente de permissão de notificações em conformidade estrita com o Apple HIG:
     - Exibição automática se `Notification.permission === 'default'`.
     - Texto neutro, explicativo, sem indução ou padrões escuros (dark patterns).
     - Botões obrigatórios: **"Voltar"** e **"Continuar"**.
     - Apenas o clique em "Continuar" dispara `Notification.requestPermission()`.
   - Persistir as inscrições de push no Supabase na tabela `push_subscriptions` associadas ao administrador logado.
   - Ajustar schema do Supabase para suportar múltiplos dispositivos por usuário (`UNIQUE (endpoint)`).
   - Disparar push notifications automáticas para todos os administradores em novas mensagens inbound de conversas diretas no WhatsApp (excluindo grupos).

---

## Fases de Execução

### Fase 1: Configuração de Variáveis de Ambiente e Biblioteca de Push
- [x] Adicionar `VITE_VAPID_PUBLIC_KEY` no `.env.local`.
- [x] Atualizar `vite-env.d.ts` com a tipagem da variável.
- [x] Atualizar `lib/pushNotifications.ts` para:
  - Consumir `import.meta.env.VITE_VAPID_PUBLIC_KEY`.
  - Salvar/atualizar a inscrição na tabela `push_subscriptions` do Supabase com o `userId` autenticado.
  - Tratar status de permissão e suporte.

### Fase 2: Banco de Dados Supabase e Edge Functions
- [x] Criar migration `supabase/migrations/20261007120000_push_subscriptions_multi_device_and_admin_notify.sql`:
  - Permitir múltiplos dispositivos por usuário alterando a restrição única para `endpoint`.
  - Habilitar RLS e policies para usuários autenticados e service role.
  - Criar função auxiliar para listar assinaturas ativas de administradores.
- [x] Atualizar `supabase/functions/send-push/index.ts`:
  - Suportar `admin_broadcast: true` (disparo para todos os admins).
  - Usar variáveis de ambiente para chaves VAPID com fallback seguro.
- [x] Atualizar `supabase/functions/whatsapp-webhook/index.ts`:
  - Ao receber mensagem inbound direta (não-grupo e não-fromMe), disparar push notification em background para os administradores.

### Fase 3: Componente de Permissão de Push no Padrão Apple HIG
- [x] Criar `components/conversations/AdminPushPermissionBanner.tsx`:
  - Card/banner de sistema com visual nativo iOS / Glassmorphism discreto.
  - Textos objetivos explicando a finalidade das notificações para o clube.
  - Dois botões neutros: **"Voltar"** (dispensa temporária) e **"Continuar"** (solicita permissão nativa).
  - Ativação de push e feedback claro (toast ou indicador de sucesso).

### Fase 4: Casca e Roteamento Standalone do Mensageiro (`/conversas`)
- [x] Criar `components/conversations/ConversationsStandalonePage.tsx`:
  - Página fullscreen de ponta a ponta (`100dvh`).
  - Integração com `AdminProtect` (somente administradores autenticados).
  - Header compacto com identificação do STC Play, status do canal WhatsApp e abas/seletor para "Mensagens", "Automações", "IA" e "Canal".
  - Modo Desktop: layout splitview WhatsApp Web (lista de conversas à esquerda 380-420px, conversa selecionada à direita).
  - Estado vazio no desktop caso nenhuma conversa esteja aberta ("Selecione uma conversa para começar").
  - Modo Mobile: navegação nativa estilo app mensageiro (lista -> conversa com botão voltar no topo).
- [x] Atualizar `App.tsx`:
  - Reconhecer rota `/conversas` ou hash `#/conversas` e renderizar `ConversationsStandalonePage`.
- [x] Atualizar `components/AdminPanel.tsx` e `components/admin/AdminNav.tsx`:
  - Ao clicar no submenu "Conversas", abrir em nova aba (`/conversas`).
  - No painel administrativo embutido, exibir um hub com atalho elegante para abrir o mensageiro fullscreen em nova aba a qualquer momento.

### Fase 5: Refatoração do Chat Mobile e Keyboard Anchor (`pwa-design-debug`)
- [x] Refatorar `useChatOverlay.ts` / criar `useMobileKeyboardAnchor.ts` para sincronização perfeita de viewport no mobile:
  - Seguir o padrão de Fix #2 do `pwa-design-debug`.
  - Escutar `visualViewport` resize e scroll.
  - Liberar altura e transform no `focusout`.
  - Garantir que o `Composer` suba colado ao teclado e não oculte o campo de texto.
  - Aplicar `safe-area-inset-bottom` responsivo quando o teclado estiver fechado e zera quando o teclado estiver aberto.

### Fase 6: Testes, Lint e Validação
- [x] Executar lint / verificação de tipos.
- [x] Testar responsividade e fluxos no navegador.
