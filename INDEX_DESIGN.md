# 📚 Índice de Documentação de Design - STC

## Estrutura de Documentos

### 1. 🎨 **DESIGN_SYSTEM.md** (Documento Principal)
**Quando usar:** Referência completa, entendimento profundo do sistema

**Conteúdo:**
- ✅ Princípios de design
- ✅ Paleta completa de cores
- ✅ Todos os gradientes com uso específico
- ✅ Sistema de sombras detalhado
- ✅ Regras de tipografia
- ✅ Espaçamento e layout
- ✅ 10+ componentes completos
- ✅ Estados interativos
- ✅ Checklist de implementação
- ✅ O que evitar

**Use quando:**
- Implementar novos componentes complexos
- Entender a filosofia do design
- Revisar padrões estabelecidos
- Onboarding de novos desenvolvedores

---

### 2. 🎯 **DESIGN_QUICK_REF.md** (Referência Rápida)
**Quando usar:** Durante desenvolvimento, consulta rápida

**Conteúdo:**
- ⚡ Snippets prontos (copy-paste)
- ⚡ Valores rápidos (bordas, padding, gap)
- ⚡ Gradientes principais
- ⚡ Tipografia resumida
- ⚡ Estados comuns
- ⚡ 10 Regras de Ouro

**Use quando:**
- Implementar componentes simples rapidamente
- Lembrar valores padrão
- Copiar snippets comuns
- Verificar regras básicas rapidamente

---

### 3. 🔧 **MODAL_PATTERN.md** (Padrão Específico)
**Quando usar:** Implementar ou modificar modais

**Conteúdo:**
- Estrutura específica de modais
- Comportamento e interação
- Variantes de modais
- Integrações

**Use quando:**
- Criar novos modais
- Modificar modais existentes
- Entender padrões de overlay

---

## 🗺️ Mapa de Navegação

```
Preciso implementar...
│
├─ ❓ Um componente NOVO e COMPLEXO
│  └─► 📖 DESIGN_SYSTEM.md (completo)
│     └─► Ler princípios → escolher componentes → adaptar
│
├─ ❓ Um componente SIMPLES ou COMUM
│  └─► ⚡ DESIGN_QUICK_REF.md (rápido)
│     └─► Copiar snippet → ajustar conteúdo
│
├─ ❓ Um MODAL
│  └─► 🔧 MODAL_PATTERN.md
│     └─► Seguir estrutura específica
│
├─ ❓ Melhorias em CHAMPIONSHIPS
│  └─► 📁 Championships.tsx (código-fonte)
│     └─► Ver implementação real
│
└─ ❓ Dúvida sobre CORES/GRADIENTES/SOMBRAS
   └─► 📖 DESIGN_SYSTEM.md → Seção específica
      └─► Paleta completa documentada
```

---

## 📋 Checklist de Uso

### Antes de Implementar Qualquer Componente:

1. **Identifique o tipo:**
   - [ ] É um card/container?
   - [ ] É um botão/ação?
   - [ ] É um header/título?
   - [ ] É um badge/tag?
   - [ ] É um modal?

2. **Consulte a documentação certa:**
   - [ ] Componente comum → `DESIGN_QUICK_REF.md`
   - [ ] Componente complexo → `DESIGN_SYSTEM.md`
   - [ ] Modal → `MODAL_PATTERN.md`

3. **Verifique os exemplos:**
   - [ ] Procure componente similar em `Championships.tsx`
   - [ ] Copie a estrutura base
   - [ ] Adapte ao seu contexto

4. **Aplique as Regras de Ouro:**
   - [ ] Border-2 mínimo
   - [ ] Shadow com cor
   - [ ] Transition sempre
   - [ ] Font-black em títulos
   - [ ] Rounded-3xl mínimo em cards
   - [ ] Hover feedback
   - [ ] Gradiente saibro em ativos

5. **Teste Estados:**
   - [ ] Normal
   - [ ] Hover
   - [ ] Active/Selected
   - [ ] Disabled (se aplicável)

---

## 🎯 Exemplos de Uso

### Cenário 1: "Preciso criar um card de torneio"

```
1. Abra DESIGN_QUICK_REF.md
2. Copie "Card com Hover"
3. Adicione conteúdo específico
4. Verifique se segue as Regras de Ouro
✅ Pronto em 2 minutos!
```

### Cenário 2: "Preciso criar um novo tipo de header"

```
1. Abra DESIGN_SYSTEM.md
2. Vá para "2. Header de Página"
3. Entenda a estrutura (gradiente 3 cores, decoração, z-index)
4. Adapte para seu contexto
5. Consulte "Decorações" se precisar de círculos
✅ Componente complexo bem estruturado!
```

### Cenário 3: "Esqueci qual gradiente usar em badges azuis"

```
1. Abra DESIGN_QUICK_REF.md
2. Seção "🎨 Gradientes Principais"
3. Procure "Badge Azul"
4. Copy: bg-linear-to-br from-blue-50 to-blue-100
✅ Resolvido em 10 segundos!
```

### Cenário 4: "Preciso saber todos os tons de saibro disponíveis"

```
1. Abra DESIGN_SYSTEM.md
2. Seção "Paleta de Cores → Cores Primárias"
3. Veja todos os tons com códigos HEX
4. Escolha o apropriado para seu contexto
✅ Decisão informada!
```

---

## 📁 Arquivos Relacionados

### Documentação de Design
- `DESIGN_SYSTEM.md` - Sistema completo ⭐ Principal
- `DESIGN_QUICK_REF.md` - Referência rápida ⚡ Consulta diária
- `MODAL_PATTERN.md` - Padrão de modais 🔧 Específico
- `INDEX_DESIGN.md` - Este arquivo 📚 Navegação

### Código-fonte de Referência
- `Championships.tsx` - Implementação completa do design system
- `BracketView.tsx` - Chaveamento com padrões premium
- `StandingsDetailModal.tsx` - Modal seguindo padrões
- `GroupStandingsCard.tsx` - Card de exemplo

---

## 🔄 Workflow Recomendado

### Para Desenvolvedores Experientes
```
QUICK_REF → Implementar → Revisar DESIGN_SYSTEM apenas se dúvida
```

### Para Novos Desenvolvedores
```
DESIGN_SYSTEM (ler uma vez completo) → QUICK_REF (bookmark) → Implementar
```

### Para Review de Código
```
Checklist no DESIGN_SYSTEM → Verificar Regras de Ouro
```

---

## 🆕 Atualizações Futuras

Quando o design system evoluir:

1. **Atualizar primeiro:** `DESIGN_SYSTEM.md`
2. **Sincronizar:** `DESIGN_QUICK_REF.md`
3. **Documentar:** Adicionar nota de versão
4. **Comunicar:** Avisar equipe

---

## 💡 Dicas

### ✅ Boas Práticas
- Mantenha `DESIGN_QUICK_REF.md` aberto durante desenvolvimento
- Consulte `DESIGN_SYSTEM.md` para dúvidas conceituais
- Use a busca (Cmd/Ctrl + F) para encontrar rapidamente

### ⚠️ Evite
- Criar padrões novos sem documentar
- Ignorar as Regras de Ouro
- Misturar padrões antigos com novos
- Copiar código de componentes não atualizados

---

**Versão:** 1.0  
**Mantido por:** Equipe STC  
**Última atualização:** 06/02/2026
