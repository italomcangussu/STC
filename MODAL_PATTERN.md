# 📋 Padrão de Modais - Guia de Implementação

## 🎯 Objetivo

Padronizar **todos** os modais do aplicativo para garantir:

- ✅ Renderização consistente via Portal
- ✅ Z-index global único (z-999)
- ✅ Comportamento uniforme de backdrop
- ✅ Experiência de usuário consistente
- ✅ Manutenibilidade e reutilização de código

---

## 🚀 Como Usar o StandardModal

### Importação

```tsx
import { StandardModal, useStandardModal } from "./StandardModal";
```

### Exemplo Básico

```tsx
function MeuComponente() {
  const { isOpen, open, close } = useStandardModal();

  return (
    <>
      <button onClick={open}>Abrir Modal</button>

      <StandardModal isOpen={isOpen} onClose={close}>
        <div className="bg-white rounded-3xl p-6 max-w-md">
          <h2 className="text-xl font-bold mb-4">Título do Modal</h2>
          <p>Conteúdo do modal aqui...</p>
          <button onClick={close}>Fechar</button>
        </div>
      </StandardModal>
    </>
  );
}
```

### Com estado customizado

```tsx
function MeuComponente() {
  const [showModal, setShowModal] = useState(false);

  return (
    <StandardModal
      isOpen={showModal}
      onClose={() => setShowModal(false)}
      verticalAlign="start"
      closeOnBackdrop={false}
    >
      {/* Conteúdo */}
    </StandardModal>
  );
}
```

---

## 🔧 Props do StandardModal

| Prop                 | Tipo                           | Padrão     | Descrição                                       |
| -------------------- | ------------------------------ | ---------- | ----------------------------------------------- |
| `isOpen`             | `boolean`                      | -          | **Obrigatório**. Controla visibilidade do modal |
| `onClose`            | `() => void`                   | -          | **Obrigatório**. Função executada ao fechar     |
| `children`           | `ReactNode`                    | -          | **Obrigatório**. Conteúdo do modal              |
| `closeOnBackdrop`    | `boolean`                      | `true`     | Permite fechar ao clicar no backdrop            |
| `containerClassName` | `string`                       | `''`       | Classes CSS adicionais para o container         |
| `verticalAlign`      | `'start' \| 'center' \| 'end'` | `'center'` | Alinhamento vertical do modal                   |

---

## 📊 Modais que PRECISAM ser Migrados

### ✅ Já Padronizados (z-999 + Portal)

- [x] `MatchScheduleModal` (Agendar partida)
- [x] `ResultModal` (Lançar resultado)
- [x] `AddReservationModal` (Nova reserva - Agenda)
- [x] `ProfessorProfile.tsx` (Modal de Novo Aluno)

### ⚠️ Pendentes de Migração

| Arquivo                          | Z-index Atual | Prioridade | Observação            |
| -------------------------------- | ------------- | ---------- | --------------------- |
| `AdminStudents.tsx`              | z-50          | 🔴 Alta    | 2 modais              |
| `AdminProfessors.tsx`            | z-50          | 🔴 Alta    | 1 modal               |
| `AdminPanel.tsx`                 | z-50, z-60    | 🔴 Alta    | 2 modais              |
| `AdminMatchCreator.tsx`          | z-70          | 🟡 Média   | 1 modal               |
| `AdminTournaments.tsx`           | z-50          | 🟡 Média   | 1 modal               |
| `Agenda.tsx`                     | z-70, z-80    | 🟡 Média   | 2 modais não migrados |
| `ScoreModal.tsx`                 | z-100         | 🟡 Média   | 1 modal               |
| `PushPermissionPrompt.tsx`       | z-100         | 🟢 Baixa   | Prompt de sistema     |
| `EditProfileModal.tsx`           | z-200         | 🟢 Baixa   | Edição de perfil      |
| `OnboardingModal.tsx`            | z-[200]       | 🟢 Baixa   | Onboarding            |
| `ChampionshipInProgress.tsx`     | z-50, z-200   | 🟡 Média   | 2 modais              |
| `AdminChampionshipDetail.tsx`    | z-200         | 🟡 Média   | 1 modal               |
| `GroupDrawPage.tsx`              | z-50          | 🟡 Média   | 2 modais              |
| `Challenges.tsx`                 | z-60, z-70    | 🟡 Média   | 3 modais              |
| `NewChampionship.tsx`            | z-60          | 🟡 Média   | 1 modal               |
| `ChampionshipAdmin.tsx`          | z-50          | 🟡 Média   | 1 modal               |
| `MatchGenerationModal.tsx`       | z-100         | 🟡 Média   | 1 modal               |
| `ChallengeNotificationPopup.tsx` | z-100         | 🟡 Média   | 2 modais              |
| `InstallPrompt.tsx`              | z-100         | 🟢 Baixa   | Prompt de instalação  |
| `AdminLogin.tsx`                 | z-60          | 🟡 Média   | 1 modal               |
| `Klanches.tsx`                   | z-60          | 🟡 Média   | 1 modal               |
| `PublicChampionshipPage.tsx`     | z-100         | 🟡 Média   | 1 modal               |
| `AdminUserEditor.tsx`            | z-60          | 🟡 Média   | 1 modal               |

**Total:** ~33 modais pendentes de migração

---

## 🔄 Processo de Migração

### Passo 1: Identificar o Modal

Buscar por:

```tsx
className="fixed inset-0 z-<valor> ...
```

### Passo 2: Substituir por StandardModal

**ANTES:**

```tsx
return (
  <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-6">{/* Conteúdo */}</div>
  </div>
);
```

**DEPOIS:**

```tsx
import { StandardModal } from "./StandardModal";

return (
  <StandardModal isOpen={isOpen} onClose={onClose}>
    <div className="bg-white rounded-3xl p-6">{/* Conteúdo */}</div>
  </StandardModal>
);
```

### Passo 3: Remover useEffect de scroll (se existir)

O `StandardModal` já gerencia o bloqueio de scroll automaticamente.

**REMOVER:**

```tsx
useEffect(() => {
  document.body.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = "unset";
  };
}, []);
```

### Passo 4: Testar

- ✅ Modal abre centralizado
- ✅ Backdrop cobre toda a tela
- ✅ Scroll bloqueado
- ✅ Fecha ao clicar no backdrop (se aplicável)
- ✅ Animação suave

---

## 📝 Padrão de Z-index Global

### Hierarquia de Camadas

```
z-0   : Conteúdo base
z-10  : Elementos elevados
z-50  : Navbar / Header fixo
z-100 : Dropdowns / Tooltips
z-500 : Toasts / Notificações
z-999 : MODAIS (StandardModal)
```

### ⚠️ IMPORTANTE

**NUNCA** use z-index superior a `z-999` em modais.  
Todos os modais **DEVEM** usar o `StandardModal` com z-999.

---

## 🎨 Variações Comuns

### Modal de Confirmação

```tsx
<StandardModal isOpen={isOpen} onClose={onClose}>
  <div className="bg-white rounded-3xl p-6 max-w-sm text-center">
    <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
    <h3 className="text-lg font-bold mb-2">Tem certeza?</h3>
    <p className="text-stone-600 mb-6">Esta ação não pode ser desfeita.</p>
    <div className="flex gap-2">
      <button onClick={onClose} className="flex-1 py-2 border rounded-xl">
        Cancelar
      </button>
      <button
        onClick={handleConfirm}
        className="flex-1 py-2 bg-red-500 text-white rounded-xl"
      >
        Confirmar
      </button>
    </div>
  </div>
</StandardModal>
```

### Modal de Formulário (Alinhado ao Topo)

```tsx
<StandardModal isOpen={isOpen} onClose={onClose} verticalAlign="start">
  <div className="bg-white rounded-3xl p-6 max-w-2xl max-h-[90vh] overflow-y-auto">
    <h2 className="text-xl font-bold mb-4">Novo Cadastro</h2>
    <form>{/* Campos do formulário */}</form>
  </div>
</StandardModal>
```

### Modal Não Fechável por Backdrop

```tsx
<StandardModal isOpen={isOpen} onClose={onClose} closeOnBackdrop={false}>
  <div className="bg-white rounded-3xl p-6">
    <p>Este modal só fecha pelo botão X</p>
    <button onClick={onClose}>Fechar</button>
  </div>
</StandardModal>
```

---

## 📱 Regras de app nativo (iOS)

- **Nada de rolagem horizontal.** `index.css` corta o eixo X de todo overlay (`StandardModal`, `role="dialog"`, `fixed inset-0`) e tira a aparência nativa dos `input[type=date|time]`, que no iOS ignoram `width:100%`. Se uma faixa precisa rolar de lado de propósito (abas, carrossel), use `overflow-x-auto` explicitamente.
- **Modal alto rola.** O painel do `StandardModal` centralizado usa `my-auto`: cabendo na tela fica centrado; não cabendo, cola no topo e rola (com `items-center` puro o topo ficava inalcançável).
- Em grid de formulário, filhos com `min-w-0` e campos com `w-full min-w-0`.

## 🔍 Checklist de Qualidade

Ao migrar um modal, verificar:

- [ ] Import do `StandardModal` adicionado
- [ ] Modal renderizado com `<StandardModal>`
- [ ] Props `isOpen` e `onClose` passadas corretamente
- [ ] useEffect de scroll removido (se existia)
- [ ] createPortal removido (se existia manualmente)
- [ ] Z-index customizado removido do JSX
- [ ] Modal testado em mobile e desktop
- [ ] Animações funcionando corretamente
- [ ] Scroll bloqueado quando modal aberto
- [ ] Backdrop clicável fecha modal (se aplicável)

---

## 📚 Exemplos de Uso no Projeto

Veja os seguintes arquivos como referência:

- `MatchScheduleModal.tsx` - Modal de agendamento de partidas
- `Championships.tsx` - ResultModal (lançamento de resultado)
- `Agenda.tsx` - AddReservationModal (nova reserva)

---

## 🎯 Próximos Passos

1. ✅ StandardModal criado
2. ✅ Documentação criada
3. ⏳ Migrar modais prioritários (z-50, z-60)
4. ⏳ Migrar modais de média prioridade (z-70 a z-100)
5. ⏳ Migrar modais de baixa prioridade (z-200+)
6. ⏳ Remover z-index customizados do CSS global
7. ⏳ Code review final

---

**Última atualização:** 05/02/2026  
**Versão:** 1.0.0
