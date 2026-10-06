import {
    Briefcase, Building2, CalendarDays, ClipboardList, Contact, GraduationCap, Landmark, LayoutDashboard,
    Megaphone, ScrollText, Sparkles, Swords, Trophy, UserCheck, Users, Vote,
    type LucideIcon,
} from 'lucide-react';
import { ALL_SECTIONS, type AdminSection, type AdminTabId } from './adminSections';

export type PendingBySection = Partial<Record<AdminTabId, number>>;

export const AREA_ICON: Record<string, LucideIcon> = {
    inicio: LayoutDashboard, quadra: CalendarDays, competicoes: Trophy, pessoas: Users, clube: Building2,
};

export const SECTION_ICON: Record<AdminTabId, LucideIcon> = {
    dashboard: LayoutDashboard, reservas: CalendarDays, desafios: Swords, lancamentos: ClipboardList,
    superset: Sparkles, torneios: Trophy, formularios: Vote, acessos: UserCheck, socios: Contact,
    alunos: GraduationCap, professores: Briefcase, financeiro: Landmark, avisos: Megaphone, regras: ScrollText,
};

export const tabDomId = (id: AdminTabId) => `admin-tab-${id}`;
export const PANEL_DOM_ID = 'admin-panel-content';


export const sectionById = (id: AdminTabId): AdminSection =>
    ALL_SECTIONS.find(s => s.id === id) ?? ALL_SECTIONS[0];
