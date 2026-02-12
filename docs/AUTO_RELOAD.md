# 🔄 Auto-Reload após Deploy

Sistema híbrido de detecção de atualizações que combina **Build Hash Check** (periódico) e **Supabase Broadcast** (instantâneo).

---

## 📋 Como Funciona

### **1. Build Hash Check** (Automático)
- Gera `version.json` automaticamente a cada build
- Frontend verifica a cada **5 minutos**
- Se detectar mudança, exibe modal de atualização

### **2. Supabase Broadcast** (Instantâneo)
- Envia notificação via WebSocket para todos os usuários online
- Notificação **instantânea** ao executar script de broadcast
- Mais rápido que polling

---

## 🚀 Workflow de Deploy

### **Passo 1: Build da Aplicação**
```bash
npm run build
```

**O que acontece:**
1. `vite build` compila o projeto
2. `postbuild` executa automaticamente
3. `version.json` é criado em `/dist` com timestamp único

### **Passo 2: Deploy no Servidor**
```bash
# Copie a pasta dist para o servidor (VPS, Vercel, etc.)
# O version.json vai junto automaticamente
```

### **Passo 3: Notificar Usuários (Opcional)**
```bash
# Execute após deploy para notificação instantânea
node scripts/broadcast-deploy.js
```

**Usuários online receberão:**
- 📡 Broadcast instantâneo via Supabase
- 🔔 Modal elegante: "Nova versão disponível! 🎉"
- ✅ Botão "Atualizar Agora" que recarrega a página

---

## ⚙️ Configuração

### **1. Já Configurado ✅**
- ✅ Hook `useVersionCheck` integrado no `App.tsx`
- ✅ Modal `UpdateNotification` com design STC
- ✅ Script `generate-version.js` configurado no `package.json`
- ✅ Canal Supabase `app_updates` ativo

### **2. Personalização (Opcional)**

**Intervalo de Verificação:**
```tsx
// Em App.tsx
const { updateAvailable, reloadApp } = useVersionCheck({
  checkInterval: 5, // Trocar para 3, 10, etc. (em minutos)
  enableBroadcast: true
});
```

**Desabilitar Broadcast:**
```tsx
const { updateAvailable, reloadApp } = useVersionCheck({
  checkInterval: 5,
  enableBroadcast: false // Apenas polling
});
```

---

## 📡 Broadcast Manual (CI/CD)

### **GitHub Actions (Exemplo)**
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm run build
      - run: # Deploy dist/
      - run: node scripts/broadcast-deploy.js
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

### **Vercel (Hook de Deploy)**
```bash
# No Vercel Dashboard:
# Settings > Git > Deploy Hooks > Post-deploy command:
node scripts/broadcast-deploy.js
```

---

## 🧪 Testar Localmente

### **1. Simular Deploy**
```bash
# Terminal 1: Rodar app
npm run dev

# Terminal 2: Simular broadcast (após 30s)
node scripts/broadcast-deploy.js
```

**Resultado:**
- Modal de atualização aparece instantaneamente
- Clique "Atualizar Agora" → página recarrega

### **2. Testar Build Hash Check**
```bash
# 1. Build inicial
npm run build
npm run preview

# 2. Abra http://localhost:3000
# 3. Aguarde ou force check no console:
localStorage.removeItem('app_version')

# 4. Novo build
npm run build

# 5. Após 5 min (ou refresh), modal aparecerá
```

---

## 🎨 Customizar Modal

Arquivo: `components/UpdateNotification.tsx`

```tsx
// Trocar texto
<h3>🎉 Nova Versão Disponível</h3>
// Para:
<h3>🚀 Atualização Pronta!</h3>

// Trocar cor do botão (gradient)
className="bg-linear-to-br from-saibro-600 to-saibro-700"
// Para:
className="bg-linear-to-br from-blue-600 to-blue-700"
```

---

## 🔍 Debug

### **Verificar versão.json**
```bash
# Após build
cat dist/version.json
# Deve mostrar: { "version": "1736696400000", "buildDate": "...", "env": "production" }
```

### **Logs no Console**
```javascript
// Console do navegador
localStorage.getItem('app_version') // Versão atual
// Se diferente do server → Modal aparece
```

### **Testar Canal Supabase**
```javascript
// Console do navegador
const channel = supabase.channel('app_updates');
channel.on('broadcast', { event: 'new_deploy' }, (payload) => {
  console.log('Broadcast recebido:', payload);
}).subscribe();
```

---

## ✅ Checklist de Deploy

- [ ] `npm run build` executado
- [ ] `version.json` existe em `dist/`
- [ ] Deploy realizado (dist/ copiado para servidor)
- [ ] **Opcional:** `node scripts/broadcast-deploy.js` executado
- [ ] Usuários online veem modal de atualização
- [ ] Clique em "Atualizar Agora" recarrega a página

---

## 📊 Comportamento por Cenário

| Cenário | Build Hash | Broadcast | Resultado |
|---------|-----------|-----------|-----------|
| **Deploy normal** | ✅ Detecta após 5min | ❌ Não enviado | Modal após 5min |
| **Deploy + Broadcast** | ✅ Detecta após 5min | ✅ Enviado | **Modal instantâneo** |
| **Usuário offline** | ✅ Detecta ao abrir app | ❌ Não recebe | Modal ao abrir |
| **Build local (dev)** | ❌ Não gera version.json | ❌ Não envia | Nenhum efeito |

---

## 🎯 Recomendações

1. **Deploy de Produção**: Sempre execute `node scripts/broadcast-deploy.js` após deploy
2. **Horário**: Evite broadcasts durante horas de pico (meio de partidas, etc.)
3. **Frequência**: Não faça mais de 1 deploy/hora (usuários vêem muitos modais)
4. **Teste**: Sempre teste em staging antes de produção

---

## 🐛 Troubleshooting

### "version.json não foi criado"
```bash
# Verificar script
node scripts/generate-version.js
# Se erro, instalar dependências:
npm install
```

### "Broadcast não funciona"
```bash
# Verificar .env
echo $VITE_SUPABASE_URL
echo $VITE_SUPABASE_ANON_KEY

# Testar conexão Supabase
node -e "
import('@supabase/supabase-js').then(({ createClient }) => {
  const client = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
  console.log('✅ Conexão OK');
});
"
```

### "Modal não aparece"
```bash
# Limpar cache
localStorage.clear()
# Recarregar página
# Aguardar 5 min ou forçar broadcast
```

---

🎉 **Sistema configurado e pronto para uso!**
