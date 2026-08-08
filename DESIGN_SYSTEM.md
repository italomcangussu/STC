# 🎨 STC Design System
## Sistema de Design Premium - Padronização Visual

> **Versão:** 1.0  
> **Última Atualização:** 06/02/2026  
> **Status:** Ativo em Championships e modais relacionados

---

## 📐 Princípios de Design

### 1. **Hierarquia Visual Clara**
- Elementos importantes devem se destacar naturalmente
- Uso de tamanho, cor e profundidade para criar hierarquia
- Informações críticas sempre visíveis

### 2. **Profundidade e Dimensão**
- Sombras coloridas para criar profundidade
- Gradientes para dar vida aos elementos
- Camadas visuais distintas (fundo, conteúdo, overlays)

### 3. **Feedback Visual Imediato**
- Todas as interações têm feedback visual
- Transições suaves (200-300ms)
- Estados claramente diferenciados

### 4. **Consistência Total**
- Mesmo padrão em todos os componentes
- Reutilização de tokens de design
- Previsibilidade na experiência

---

## 🎨 Paleta de Cores

> **Fonte da verdade:** o bloco `@theme` de [`index.css`](index.css). Os valores abaixo
> são cópia dele — ao alterar um token, altere nos dois lugares.

### Cores Primárias

```tsx
// SAIBRO - Cor principal do brand
saibro-50:  '#fff7ed'  // Backgrounds sutis
saibro-100: '#ffedd5'  // Backgrounds leves
saibro-200: '#fed7aa'  // Borders, badges
saibro-300: '#fdba74'  // Sombras coloridas
saibro-400: '#fb923c'
saibro-500: '#f97316'  // Cor base
saibro-600: '#ea580c'  // Primária principal
saibro-700: '#c2410c'  // Hover states
saibro-800: '#9a3412'  // Pressed states
saibro-900: '#7c2d12'
saibro-950: '#431407'
```

### Cores Neutras

```tsx
// STONE - Neutros sofisticados
stone-50:  '#fafaf9'  // Backgrounds alternados
stone-100: '#f5f5f4'  // Backgrounds, dividers
stone-200: '#e7e5e4'  // Borders padrão
stone-300: '#d6d3d1'  // Borders disabled
stone-400: '#a8a29e'  // Text secondary
stone-500: '#78716c'  // Text tertiary
stone-600: '#57534e'  // Text secondary bold
stone-700: '#44403c'  // Text primary
stone-800: '#292524'  // Text dark headers
stone-900: '#1c1917'  // Text darkest, backgrounds escuros
stone-950: '#0c0a09'
```

### Cores de Suporte

```tsx
// SUCESSO - Verde
emerald-50:  '#ECFDF5'
emerald-200: '#A7F3D0'
emerald-600: '#059669'
emerald-700: '#047857'

// ATENÇÃO - Azul
blue-50:  '#EFF6FF'
blue-100: '#DBEAFE'
blue-200: '#BFDBFE'
blue-600: '#2563EB'
blue-700: '#1D4ED8'

// ALERTA - Laranja (complementa saibro)
orange-50:  '#FFF7ED'
orange-500: '#F97316'
```

---

## 🌈 Gradientes

### Gradientes Principais

#### **Saibro Premium** (Headers, Botões Primários)
```tsx
className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500"
```
- **Uso:** Headers de página, botões de ação principal
- **Com borda:** `border-2 border-white/10`
- **Texto:** Sempre branco

#### **Saibro 2-Cores** (Botões, Cards Ativos)
```tsx
className="bg-linear-to-br from-saibro-600 to-saibro-700"
```
- **Uso:** Botões secundários, tabs ativas, badges importantes
- **Sombra:** `shadow-lg shadow-saibro-200`

#### **Stone Sutil** (Backgrounds, Sections)
```tsx
className="bg-linear-to-r from-stone-50 to-stone-100"
```
- **Uso:** Backgrounds de seções, dividers premium
- **Texto:** stone-800 ou mais escuro

#### **Escuro Premium** (Badges, Tags)
```tsx
className="bg-linear-to-br from-stone-800 to-stone-900"
```
- **Uso:** Tags de classe, badges de destaque
- **Texto:** Branco
- **Sombra:** `shadow-md`

#### **Sucesso** (Status Finalizado)
```tsx
className="bg-linear-to-br from-emerald-50 to-green-50"
```
- **Borda:** `border-2 border-emerald-200`
- **Texto:** `text-emerald-600` ou `text-emerald-700`

#### **Info/Agendado** (Status Agendado)
```tsx
className="bg-linear-to-br from-saibro-50 to-orange-50"
```
- **Borda:** `border-2 border-saibro-200`
- **Texto:** `text-saibro-700` ou `text-saibro-800`

### Backgrounds com Vencedor (Highlight Sutil)
```tsx
className="bg-linear-to-r from-saibro-50/40 to-orange-50/20"
```
- **Uso:** Linhas de jogador vencedor
- **Borda adicional:** `border-saibro-200`

---

## 💫 Sombras

### Sombras Padrão

#### **Sombra Suave** (Cards normais)
```tsx
className="shadow-lg shadow-stone-200/50"
```

#### **Sombra Forte** (Headers, Modais)
```tsx
className="shadow-xl shadow-stone-200/50"
```

#### **Sombra Extra** (Overlays importantes)
```tsx
className="shadow-2xl shadow-stone-300/30"
```

### Sombras Coloridas

#### **Saibro** (Elementos com gradiente saibro)
```tsx
className="shadow-lg shadow-saibro-200"     // Normal
className="shadow-xl shadow-saibro-200"     // Forte
className="shadow-xl shadow-saibro-300/30"  // Headers
```

#### **Azul** (Botões secundários)
```tsx
className="shadow-lg shadow-blue-200"
```

#### **Sucesso**
```tsx
className="shadow-lg shadow-emerald-200"
```

### Sombras em Texto
```tsx
className="drop-shadow-lg"  // Títulos importantes
className="drop-shadow-md"  // Subtítulos
className="drop-shadow"     // Ícones em backgrounds escuros
```

---

## 🔲 Bordas e Arredondamento

### Espessura de Bordas

```tsx
border       // 1px - NÃO USAR (muito fino)
border-2     // 2px - PADRÃO para cards
border-3     // 3px - Para avatares e destaque
```

### Arredondamento

```tsx
rounded-xl   // 12px - Badges pequenos
rounded-2xl  // 16px - Botões, inputs
rounded-3xl  // 24px - Cards, containers
rounded-4xl  // 32px - Headers, containers grandes
rounded-full // Círculos perfeitos (avatares, badges)
```

### Regras de Arredondamento
- **Badges/Tags:** `rounded-xl`
- **Botões:** `rounded-xl` ou `rounded-2xl`
- **Cards normais:** `rounded-3xl`
- **Headers/Containers grandes:** `rounded-4xl`
- **Avatares:** `rounded-full`

---

## 📝 Tipografia

### Hierarquia de Tamanhos

```tsx
// TÍTULOS PRINCIPAIS (Headers de página)
text-3xl (30px) font-black uppercase tracking-tight

// SUBTÍTULOS IMPORTANTES (Headers de seção)
text-xl (20px) font-black uppercase tracking-tight

// TÍTULOS DE CARD
text-base ou text-lg (16-18px) font-black

// TÍTULOS PEQUENOS (Headers de modal, subtítulos)
text-sm (14px) font-black uppercase tracking-tight

// TEXTO NORMAL
text-sm (14px) font-bold ou font-medium

// TEXTO PEQUENO (Metadados, labels)
text-xs (12px) font-bold

// TEXTO EXTRA PEQUENO (Badges)
text-[10px] (10px) font-black uppercase tracking-wider
```

### Pesos de Fonte

```tsx
font-medium  // 500 - Texto descritivo
font-bold    // 700 - Texto importante
font-black   // 900 - Títulos, labels, ênfase máxima
```

### Tracking (Espaçamento de Letras)

```tsx
tracking-tight   // Títulos grandes (economiza espaço)
tracking-normal  // Padrão
tracking-wide    // Badges, metadados
tracking-wider   // Badges importantes
tracking-widest  // NÃO USAR (muito espaçado)
```

### Uppercase

```tsx
// Use uppercase APENAS em:
- Títulos de seção (h3, h4)
- Badges e tags
- Botões de ação
- Labels muito pequenos

// NÃO use em:
- Títulos principais (h1, h2)
- Texto de parágrafo
- Nomes de pessoas
```

---

## 📏 Espaçamento

### Padding

```tsx
// CARDS
p-5  // 20px - Cards menores
p-6  // 24px - Cards médios (PADRÃO)
p-8  // 32px - Cards grandes, headers

// BOTÕES
px-4 py-2    // Pequenos
px-5 py-2.5  // Médios (PADRÃO)
px-6 py-3    // Grandes
```

### Gap

```tsx
gap-1.5  // 6px  - Elementos muito próximos
gap-2    // 8px  - Padrão para badges, scores
gap-3    // 12px - Entre elementos relacionados
gap-4    // 16px - Entre seções pequenas
gap-5    // 20px - Entre elementos de card
gap-6    // 24px - Entre seções (PADRÃO)
```

### Space-y (Espaçamento vertical em stacks)

```tsx
space-y-3  // 12px - Elementos compactos
space-y-4  // 16px - Padrão para listas
space-y-5  // 20px - Entre players em match card
space-y-6  // 24px - Entre seções (PADRÃO)
```

---

## 🎯 Componentes - Padrões

### 1. **Card Container**

```tsx
<div className="bg-white rounded-3xl p-6 shadow-lg shadow-stone-200/50 border-2 border-stone-100 relative overflow-hidden">
  {/* Conteúdo */}
</div>
```

**Variações:**
- Hover: `hover:shadow-xl hover:border-saibro-300 hover:scale-[1.01] transition-all duration-300`
- Com decoração: Adicionar círculos decorativos com `absolute`

### 2. **Header de Página**

```tsx
<div className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 p-8 rounded-4xl shadow-2xl shadow-saibro-300/30 text-white relative overflow-hidden border-2 border-white/10">
  {/* Ícone decorativo */}
  <div className="absolute right-[-20px] top-[-20px] opacity-[0.08] rotate-12">
    <Trophy size={200} strokeWidth={1.5} />
  </div>
  
  {/* Conteúdo */}
  <div className="relative z-10">
    <h1 className="text-3xl font-black uppercase tracking-tight drop-shadow-lg">
      Título
    </h1>
  </div>
</div>
```

### 3. **Botão Primário**

```tsx
<button className="bg-linear-to-br from-saibro-600 to-saibro-700 text-white text-xs font-black uppercase px-5 py-2.5 rounded-xl shadow-lg shadow-saibro-200 hover:shadow-xl hover:scale-105 transition-all duration-200">
  Ação Principal
</button>
```

### 4. **Botão Secundário/Escuro**

```tsx
<button className="bg-linear-to-br from-stone-800 to-stone-900 text-white text-xs font-black uppercase px-5 py-2.5 rounded-xl shadow-lg shadow-stone-300 hover:shadow-xl hover:scale-105 transition-all duration-200">
  Ação Secundária
</button>
```

### 5. **Botão Disabled**

```tsx
<button 
  disabled
  className="bg-stone-50 text-stone-300 text-xs font-black uppercase px-5 py-2.5 rounded-xl cursor-not-allowed"
>
  Desabilitado
</button>
```

### 6. **Badge/Tag Colorido**

```tsx
// Saibro
<span className="text-xs font-black bg-linear-to-br from-saibro-50 to-orange-50 text-saibro-700 px-3 py-1.5 rounded-xl border-2 border-saibro-200">
  Saibro
</span>

// Azul
<span className="text-xs font-black bg-linear-to-br from-blue-50 to-blue-100 text-blue-700 px-3 py-1.5 rounded-xl border-2 border-blue-200">
  Rápida
</span>

// Escuro
<span className="text-xs font-black bg-linear-to-br from-stone-800 to-stone-900 text-white px-3 py-1.5 rounded-xl shadow-md">
  Premium
</span>
```

### 7. **Avatar com Border**

```tsx
// Normal
<img 
  src={avatar} 
  className="w-12 h-12 rounded-full border-3 border-stone-200 object-cover transition-all duration-300"
/>

// Vencedor
<img 
  src={avatar} 
  className="w-12 h-12 rounded-full border-3 border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100 object-cover"
/>
```

### 8. **Score Badge**

```tsx
// Vencedor
<span className="w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black shadow-sm bg-linear-to-br from-saibro-500 to-saibro-600 text-white shadow-saibro-200">
  6
</span>

// Perdedor
<span className="w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black bg-stone-100 text-stone-400">
  4
</span>

// Vazio
<span className="w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black bg-stone-50 border-2 border-dashed border-stone-200 text-stone-300">
  -
</span>
```

### 9. **Tab Navigation**

```tsx
<div className="flex bg-white p-2 rounded-3xl shadow-lg shadow-stone-200/50 border-2 border-stone-100 gap-2">
  {/* Tab Ativa */}
  <button className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-all duration-300 bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-lg shadow-saibro-200 scale-105">
    <Trophy size={16} /> Ativa
  </button>
  
  {/* Tab Inativa */}
  <button className="flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-all duration-300 text-stone-500 hover:text-stone-700 hover:bg-stone-50">
    <Calendar size={16} /> Inativa
  </button>
</div>
```

### 10. **Status Badge**

```tsx
// Finalizado
<div className="bg-linear-to-br from-emerald-50 to-green-50 px-4 py-2.5 rounded-2xl border-2 border-emerald-200 shadow-sm text-center">
  <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider mb-0.5">Finalizado</p>
  <span className="text-sm font-black text-emerald-700">FIM</span>
</div>

// Agendado
<div className="bg-linear-to-br from-saibro-50 to-orange-50 px-4 py-2.5 rounded-2xl border-2 border-saibro-200 shadow-md">
  <p className="text-[9px] font-black text-saibro-700 uppercase tracking-wider mb-1.5">Agendado</p>
  <div className="flex items-center gap-1.5 text-xs font-bold text-saibro-800">
    <Calendar size={12} /> 15/02/2026
  </div>
</div>

// Pendente
<div className="bg-stone-50 px-4 py-3 rounded-2xl border-2 border-dashed border-stone-200 text-center">
  <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-stone-300 mb-2 mx-auto">
    <Calendar size={18} />
  </div>
  <p className="text-[10px] font-black text-stone-400 uppercase tracking-wider">Pendente</p>
</div>
```

---

## ⚡ Estados Interativos

### Hover

```tsx
// Cards
hover:shadow-xl hover:border-saibro-300 hover:scale-[1.01]

// Botões
hover:shadow-xl hover:scale-105

// Tabs inativas
hover:bg-stone-50 hover:text-stone-700

// Botões de navegação
hover:scale-110
```

### Transições

```tsx
// Padrão
transition-all duration-300

// Rápida (botões, hover)
transition-all duration-200

// Apenas cores
transition-colors duration-200
```

### Active/Selected

- **Usar gradiente saibro** (`from-saibro-600 to-saibro-700`)
- **Shadow colorida** (`shadow-lg shadow-saibro-200`)
- **Scale sutil** (`scale-105` ou `scale-[1.02]`)
- **Texto branco**

### Disabled

- **Background:** `bg-stone-50`
- **Texto:** `text-stone-300`
- **Cursor:** `cursor-not-allowed`
- **SEM hover effects**

---

## 🎨 Decorações

### Círculos Decorativos

```tsx
{/* Top-right */}
<div className="absolute top-0 right-0 w-40 h-40 bg-saibro-500/5 rounded-full -mr-20 -mt-20" />

{/* Bottom-left */}
<div className="absolute bottom-0 left-0 w-28 h-28 bg-blue-500/5 rounded-full -ml-14 -mb-14" />

{/* Meio */}
<div className="absolute top-1/2 right-1/4 w-20 h-20 bg-white/5 rounded-full" />
```

### Ícones Decorativos Grandes

```tsx
<div className="absolute right-[-20px] top-[-20px] opacity-[0.08] rotate-12">
  <Trophy size={200} strokeWidth={1.5} />
</div>
```

**Opacidades recomendadas:** `0.05` a `0.10`

---

## 📋 Checklist de Implementação

Ao criar um novo componente, verifique:

### ✅ Visual Base
- [ ] Card usa `rounded-3xl` ou maior
- [ ] Border é `border-2` (mínimo)
- [ ] Shadow usa cor (`shadow-stone-200/50` ou similar)
- [ ] Padding é generoso (`p-6` mínimo)

### ✅ Tipografia
- [ ] Títulos são `font-black`
- [ ] Usa `uppercase` em títulos pequenos
- [ ] Tracking adequado (`tracking-tight` em grandes, `tracking-wider` em pequenos)

### ✅ Cores
- [ ] Gradientes em elementos importantes
- [ ] Texto tem contraste suficiente
- [ ] Estados ativos usam gradiente saibro

### ✅ Interatividade
- [ ] Hover tem feedback visual
- [ ] Transições são suaves (300ms padrão)
- [ ] Disabled é claramente diferente

### ✅ Consistência
- [ ] Icons têm tamanho apropriado (16-18px padrão)
- [ ] Gaps são múltiplos de 4px
- [ ] Segue padrões de componentes similares

---

## 🚫 O Que NÃO Fazer

### ❌ Evitar

1. **Bordas finas:** Nunca `border` (1px), sempre `border-2` ou `border-3`
2. **Sombras sem cor:** `shadow-sm` sozinho é fraco, adicione cor
3. **Gradientes aleatórios:** Use apenas os gradientes definidos
4. **Font-bold em títulos:** Títulos devem ser `font-black`
5. **Arredondamento pequeno:** Mínimo `rounded-2xl` para botões/cards
6. **Hover sem transição:** Sempre adicione `transition-all` ou `transition-colors`
7. **Texto em caixa alta grande:** Uppercase apenas em pequenos
8. **Padding apertado:** Mínimo `p-5` para cards
9. **Ícones sem variação de strokeWidth:** Use strokeWidth quando relevante
10. **Misturar padrões:** Seja consistente dentro da mesma seção

---

## 🔄 Versionamento

### Versão 1.0 (06/02/2026)
- ✅ Sistema inicial estabelecido
- ✅ Aplicado em Championships (público)
- ✅ Aplicado em BracketView, StandingsDetailModal
- ✅ 30+ componentes padronizados

### Próximas Melhorias
- [ ] Estender para ChampionshipAdmin
- [ ] Criar variantes para dark mode
- [ ] Documentar animações complexas
- [ ] Criar biblioteca de componentes reutilizáveis

---

## 📚 Recursos Adicionais

### Ferramentas Recomendadas
- **Tailwind Play:** Para testar gradientes e sombras
- **Coolors.co:** Para verificar paletas
- **Lucide Icons:** Biblioteca de ícones usada

### Referências
- Componentes base: `Championships.tsx`
- Modais: `BracketView.tsx`, `StandingsDetailModal.tsx`
- Headers: Ver seção de Header em Championships

---

**Mantido por:** Equipe de Desenvolvimento STC  
**Contato:** Para sugestões de melhoria, abrir issue no repositório
