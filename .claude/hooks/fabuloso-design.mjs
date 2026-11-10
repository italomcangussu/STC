#!/usr/bin/env node
// Gerado pela fabuloso-design (design.mjs hook instalar). Acha a skill nesta máquina e repassa o evento do hook;
// sem a skill instalada, não faz nada. Desligar só nesta sessão: FABDESIGN_HOOK=0.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawnSync } from 'node:child_process';
if (process.env.FABDESIGN_HOOK === '0') process.exit(0);
const h = os.homedir(); const c = [process.env.FABDESIGN_DIR, path.join(h, '.claude/skills/fabuloso-design'), path.join(h, '.agents/skills/fabuloso-design')];
for (const base of [path.join(h, '.claude/skills/synced'), path.join(h, '.claude/skills')]) { try { for (const d of fs.readdirSync(base)) c.push(path.join(base, d, 'fabuloso-design')); } catch {} }
const temHook = (d) => { try { return /cmdHook/.test(fs.readFileSync(path.join(d, 'scripts', 'design.mjs'), 'utf8')); } catch { return false; } };
const dir = c.find((d) => d && temHook(d)); // versão antiga da skill (sem hook) é ignorada
if (!dir) process.exit(0);
const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'design.mjs'), 'hook'], { input: fs.readFileSync(0, 'utf8'), encoding: 'utf8', timeout: 25000 });
try { const j = JSON.parse(r.stdout || ''); if (j.hookSpecificOutput || j.decision) process.stdout.write(JSON.stringify(j)); } catch { /* nada a dizer */ }
process.exit(0);
