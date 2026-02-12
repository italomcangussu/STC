# 🎯 Quick Reference - Design System STC

> **Para implementações rápidas - Guia de consulta imediata**

---

## 🚀 Copy-Paste Rápido

### Card Padrão
```tsx
<div className="bg-white rounded-3xl p-6 shadow-lg shadow-stone-200/50 border-2 border-stone-100">
  {/* Conteúdo */}
</div>
```

### Card com Hover
```tsx
<div className="bg-white rounded-3xl p-6 shadow-lg shadow-stone-200/50 border-2 border-stone-100 hover:shadow-xl hover:border-saibro-300 hover:scale-[1.01] transition-all duration-300">
  {/* Conteúdo */}
</div>
```

### Botão Primário
```tsx
<button className="bg-linear-to-br from-saibro-600 to-saibro-700 text-white text-xs font-black uppercase px-5 py-2.5 rounded-xl shadow-lg shadow-saibro-200 hover:shadow-xl hover:scale-105 transition-all duration-200">
  Label
</button>
```

### Botão Secundário
```tsx
<button className="bg-linear-to-br from-stone-800 to-stone-900 text-white text-xs font-black uppercase px-5 py-2.5 rounded-xl shadow-lg shadow-stone-300 hover:shadow-xl hover:scale-105 transition-all duration-200">
  Label
</button>
```

### Header de Página
```tsx
<div className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 p-8 rounded-4xl shadow-2xl shadow-saibro-300/30 text-white border-2 border-white/10">
  <h1 className="text-3xl font-black uppercase tracking-tight drop-shadow-lg">Título</h1>
</div>
```

### Header de Seção
```tsx
<div className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 px-6 py-4 rounded-3xl shadow-xl shadow-saibro-300/30 text-white border-2 border-white/10">
  <h3 className="text-base font-black uppercase tracking-tight flex items-center gap-2">
    <Trophy size={18} className="drop-shadow" />
    Seção
  </h3>
</div>
```

### Badge Saibro
```tsx
<span className="text-xs font-black bg-linear-to-br from-saibro-50 to-orange-50 text-saibro-700 px-3 py-1.5 rounded-xl border-2 border-saibro-200">
  Label
</span>
```

### Badge Azul
```tsx
<span className="text-xs font-black bg-linear-to-br from-blue-50 to-blue-100 text-blue-700 px-3 py-1.5 rounded-xl border-2 border-blue-200">
  Label
</span>
```

### Avatar Normal
```tsx
<img 
  src={avatar} 
  className="w-12 h-12 rounded-full border-3 border-stone-200 object-cover transition-all"
/>
```

### Avatar Vencedor
```tsx
<img 
  src={avatar} 
  className="w-12 h-12 rounded-full border-3 border-saibro-500 shadow-lg shadow-saibro-200 ring-2 ring-saibro-100 object-cover"
/>
```

---

## 📏 Valores Rápidos

### Bordas
```
border-2  ← PADRÃO para cards
border-3  ← Avatares e destaque
```

### Arredondamento
```
rounded-xl   ← Badges
rounded-2xl  ← Botões
rounded-3xl  ← Cards (PADRÃO)
rounded-4xl  ← Headers grandes
```

### Padding Cards
```
p-5  ← Pequeno
p-6  ← PADRÃO
p-8  ← Headers
```

### Gap
```
gap-2  ← Entre badges/scores
gap-3  ← Entre elementos próximos
gap-5  ← Dentro de cards
gap-6  ← Entre seções (PADRÃO)
```

### Sombras
```
shadow-lg shadow-stone-200/50    ← Card padrão
shadow-xl shadow-stone-200/50    ← Card hover
shadow-lg shadow-saibro-200      ← Botão saibro
shadow-2xl shadow-saibro-300/30  ← Header
```

---

## 🎨 Gradientes Principais

```tsx
// Header/Principal
"bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500"

// Botão Primário
"bg-linear-to-br from-saibro-600 to-saibro-700"

// Botão Escuro
"bg-linear-to-br from-stone-800 to-stone-900"

// Badge Saibro
"bg-linear-to-br from-saibro-50 to-orange-50"

// Badge Azul
"bg-linear-to-br from-blue-50 to-blue-100"

// Sucesso
"bg-linear-to-br from-emerald-50 to-green-50"

// Section Header
"bg-linear-to-r from-stone-50 to-stone-100"

// Winner Highlight
"bg-linear-to-r from-saibro-50/40 to-orange-50/20"
```

---

## 📝 Tipografia

### Títulos
```tsx
text-3xl font-black uppercase tracking-tight           // H1 (30px)
text-xl font-black uppercase tracking-tight            // H2 (20px)
text-base font-black uppercase tracking-tight          // H3 (16px)
text-sm font-black uppercase tracking-tight            // H4 (14px)
```

### Corpo
```tsx
text-sm font-bold      // Normal (14px)
text-xs font-bold      // Pequeno (12px)
text-[10px] font-black // Micro (10px) - sempre uppercase
```

---

## ⚡ Estados

### Hover (Botões)
```tsx
hover:shadow-xl hover:scale-105 transition-all duration-200
```

### Hover (Cards)
```tsx
hover:shadow-xl hover:border-saibro-300 hover:scale-[1.01] transition-all duration-300
```

### Active/Selected
```tsx
bg-linear-to-br from-saibro-600 to-saibro-700 
text-white 
shadow-lg shadow-saibro-200 
scale-105
```

### Disabled
```tsx
bg-stone-50 
text-stone-300 
cursor-not-allowed
```

---

## 🎯 Regras de Ouro

1. ✅ Sempre `border-2` (nunca `border`)
2. ✅ Sempre `shadow` com cor
3. ✅ Sempre `transition-all` ou `transition-colors`
4. ✅ Títulos = `font-black`
5. ✅ Cards = mínimo `rounded-3xl`
6. ✅ Padding = mínimo `p-5`
7. ✅ Hover = sempre tem feedback
8. ✅ Gradientes = usar os definidos
9. ✅ Uppercase = só em pequenos
10. ✅ Icons = com strokeWidth quando apropriado

---

**Documento Completo:** `DESIGN_SYSTEM.md`
