import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Loader2, Megaphone } from 'lucide-react';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { Championships } from './components/Championships';
import { Athletes } from './components/Athletes';
import { Ranking } from './components/Ranking';
import { Agenda } from './components/Agenda';
import { ChallengesView } from './components/Challenges';
import { SuperSet } from './components/SuperSet';
import { AdminProtect } from './components/AdminProtect';
import { Auth } from './components/Auth';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ConfirmProvider } from './components/ui/ConfirmProvider';
import { User } from './types';
import { supabase } from './lib/supabase';

// 🚀 Code Splitting via React.lazy (Uncle Bob Performance Optimization)
// O Dashboard é a única tela que usa `recharts` (~109 kB comprimidos). Estático,
// ele cobrava esse peso de todo sócio que abre o app na Agenda e nunca clica em
// Dashboard.
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const Klanches = lazy(() => import('./components/Klanches').then(m => ({ default: m.Klanches })));
const TenisProPlayer = lazy(() => import('./components/TenisProPlayer').then(m => ({ default: m.TenisProPlayer })));
const ProfessorProfile = lazy(() => import('./components/ProfessorProfile').then(m => ({ default: m.ProfessorProfile })));
const AdminProfessors = lazy(() => import('./components/AdminProfessors').then(m => ({ default: m.AdminProfessors })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
const FinanceHub = lazy(() => import('./components/finance/FinanceHub').then(m => ({ default: m.FinanceHub })));
const MemberFinance = lazy(() => import('./components/finance/MemberFinance').then(m => ({ default: m.MemberFinance })));
const AdminStudents = lazy(() => import('./components/AdminStudents').then(m => ({ default: m.AdminStudents })));
const ChampionshipAdmin = lazy(() => import('./components/ChampionshipAdmin').then(m => ({ default: m.ChampionshipAdmin })));
const ChampionshipCreator = lazy(() => import('./components/ChampionshipCreator').then(m => ({ default: m.ChampionshipCreator })));
const AdminForms = lazy(() => import('./components/AdminForms').then(m => ({ default: m.AdminForms })));
const AppSettings = lazy(() => import('./components/AppSettings').then(m => ({ default: m.AppSettings })));
const DocumentsPage = lazy(() => import('./components/signatures/DocumentsPage').then(m => ({ default: m.DocumentsPage })));
const ConversationsStandalonePage = lazy(() => import('./components/conversations/ConversationsStandalonePage').then(m => ({ default: m.ConversationsStandalonePage })));
import { getPublicChampionshipRoute, PublicChampionshipRoute, selectPublicChampionship } from './lib/publicRoutes';
import { clearDocumentsHash, parseDocumentsHash, showDocumentsList, viewFromHash } from './lib/signatures/routes';

import { OnboardingModal } from './components/OnboardingModal';
import { ChallengeNotificationPopup } from './components/ChallengeNotificationPopup';
import { PublicChampionshipPage } from './components/PublicChampionshipPage';
import { PublicFormPage } from './components/PublicFormPage';
import { UpdateNotification } from './components/UpdateNotification';
import { useVersionCheck } from './hooks/useVersionCheck';

interface Announcement {
  id: string;
  title: string;
  message: string;
  imageUrl: string | null;
  showOnce: boolean;
}

const PublicChampionshipEntry: React.FC<{ route: PublicChampionshipRoute }> = ({ route }) => {
  const [publicTarget, setPublicTarget] = useState<{ slug?: string; championshipId?: string } | null>(
    route.type === 'slug' ? { slug: route.slug } : null
  );
  const [loadingPublic, setLoadingPublic] = useState(route.type === 'list');

  useEffect(() => {
    const fetchActiveChampionship = async () => {
      if (route.type !== 'list') return;

      try {
        const { data: champs, error } = await supabase
          .from('championships')
          .select('id, slug, status, registration_open, created_at')
          .order('created_at', { ascending: false });

        if (error) {
          throw error;
        }

        const selected = selectPublicChampionship(champs || []);

        if (selected) {
          setPublicTarget(selected.slug
            ? { slug: selected.slug }
            : { championshipId: selected.id }
          );
        } else {
          setPublicTarget({ slug: 'nenhum-campeonato' });
        }
      } catch (err) {
        console.error('Error fetching active public championship:', err);
        setPublicTarget({ slug: 'erro-campeonato' });
      } finally {
        setLoadingPublic(false);
      }
    };

    fetchActiveChampionship();
  }, [route]);

  if (loadingPublic) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900">
        <Loader2 className="animate-spin text-saibro-500" size={48} />
      </div>
    );
  }

  return <PublicChampionshipPage {...(publicTarget || { slug: 'nenhum-campeonato' })} />;
};

// -- COMPONENT: Announcement Popup --
const AnnouncementPopup: React.FC<{ user: User, onClose: () => void }> = ({ user, onClose }) => {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnnouncement = async () => {
      const { data } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const ann = data[0];
        const seenKey = `ann_seen_${ann.id}_${user.id}`;
        const hasSeen = localStorage.getItem(seenKey);

        // If show_once and already seen, skip
        if (ann.show_once && hasSeen) {
          setAnnouncement(null);
        } else {
          setAnnouncement({
            id: ann.id,
            title: ann.title,
            message: ann.message,
            imageUrl: ann.image_url,
            showOnce: ann.show_once
          });
        }
      }
      setLoading(false);
    };
    fetchAnnouncement();
  }, [user.id]);

  const handleClose = () => {
    if (announcement) {
      const seenKey = `ann_seen_${announcement.id}_${user.id}`;
      localStorage.setItem(seenKey, Date.now().toString());
    }
    onClose();
  };

  if (loading || !announcement) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300">
        {announcement.imageUrl ? (
          <img src={announcement.imageUrl} alt="" className="w-full h-40 object-cover" />
        ) : (
          <div className="h-32 bg-saibro-500 relative flex items-center justify-center overflow-hidden">
            <div className="absolute -top-10 -left-10 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute top-10 right-10 w-16 h-16 bg-white/10 rounded-full" />
            <Megaphone size={48} className="text-white relative z-10" />
          </div>
        )}
        <div className="p-6 text-center space-y-4">
          <h3 className="text-2xl font-bold text-saibro-900">{announcement.title}</h3>
          <p className="text-stone-600 whitespace-pre-wrap">{announcement.message}</p>
          <button onClick={handleClose} className="w-full py-3 bg-saibro-600 hover:bg-saibro-700 text-white font-bold rounded-xl shadow-lg shadow-orange-200 transition-all">
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};

// -- MAIN CONTENT WRAPPER --
const AppContent: React.FC = () => {
  const { currentUser, loading, signOut } = useAuth();
  // Links com `#` abrem direto na aba certa: o aviso de comprovante (`/#meu-financeiro`) e o
  // WhatsApp de assinatura (`/#documentos/<id>`). O estado nasce antes do login e sobrevive a ele.
  const [view, setView] = useState(() => (typeof window !== 'undefined' ? viewFromHash(window.location.hash) : 'agenda'));
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const [targetAthleteId, setTargetAthleteId] = useState<string | null>(null);
  const [showChallengeNotification, setShowChallengeNotification] = useState(true);

  // 🔄 Version Check - Auto-reload on deploy
  const { updateAvailable, reloadApp } = useVersionCheck({
    checkInterval: 5, // Check every 5 minutes
    enableBroadcast: true // Listen to Supabase broadcasts
  });

  // App já aberto e o sócio toca num link de documento: troca de aba sem recarregar.
  useEffect(() => {
    const onHash = () => { if (parseDocumentsHash(window.location.hash)) setView('documentos'); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Saiu da aba de documentos: o `#documentos/…` não pode reabri-la depois; tocar nela de novo volta à lista.
  const changeView = (next: string) => {
    if (next === 'documentos') showDocumentsList(); else clearDocumentsHash();
    setView(next);
  };

  const handleOpenProfile = (userId: string) => {
    setTargetAthleteId(userId);
    changeView('atletas');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-saibro-50">
        <Loader2 className="animate-spin text-saibro-600" size={48} />
      </div>
    );
  }

  if (!currentUser) {
    return <Auth />;
  }

  // Check if onboarding is needed (name is missing or category is default/missing)
  const needsOnboarding = !currentUser.name || currentUser.name.trim() === '';

  return (
    <>
      <Layout view={view} setView={changeView} currentUser={currentUser} onLogout={signOut}>
        <Suspense fallback={
          <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3">
            <Loader2 className="animate-spin text-saibro-600" size={36} />
            <span className="text-xs font-bold text-saibro-700 uppercase tracking-wider">Carregando módulo...</span>
          </div>
        }>
          <div key={view} className="animate-page-enter">
            {view === 'agenda' && <Agenda currentUser={currentUser} />}
            {view === 'dashboard' && <Dashboard />}
            {view === 'klanches' && <Klanches currentUser={currentUser} />}
            {view === 'desafios' && <ChallengesView currentUser={currentUser} />}
            {view === 'superset' && <SuperSet />}
            {view === 'tenisproplayer' && <TenisProPlayer />}
            {view === 'campeonatos' && <Championships currentUser={currentUser} />}
            {view === 'competicao' && <Championships currentUser={currentUser} />}
            {view === 'atletas' && <Athletes initialUserId={targetAthleteId} currentUser={currentUser} onClearRequest={() => setTargetAthleteId(null)} />}
            {view === 'perfil' && <Athletes initialUserId={currentUser.id} currentUser={currentUser} onClearRequest={() => setView('dashboard')} />}
            {view === 'ranking' && <Ranking onSelectProfile={handleOpenProfile} />}
            {view === 'professor' && <ProfessorProfile currentUser={currentUser} />}
            {view === 'admin-students' && <AdminProtect><AdminStudents /></AdminProtect>}
            {view === 'admin-professors' && <AdminProtect><AdminProfessors /></AdminProtect>}
            {view === 'admin-panel' && <AdminProtect><AdminPanel /></AdminProtect>}
            {view === 'financeiro-admin' && <AdminProtect><FinanceHub /></AdminProtect>}
            {view === 'meu-financeiro' && <MemberFinance currentUser={currentUser} />}
            {view === 'documentos' && <DocumentsPage currentUser={currentUser} />}
            {view === 'championship-admin' && <AdminProtect><ChampionshipAdmin currentUser={currentUser} /></AdminProtect>}
            {view === 'championship-creator' && <AdminProtect><ChampionshipCreator /></AdminProtect>}
            {view === 'configuracoes' && <AppSettings currentUser={currentUser} />}
            {view === 'admin-forms' && <AdminProtect><AdminForms /></AdminProtect>}
          </div>
        </Suspense>
      </Layout>
      {showAnnouncement && !needsOnboarding && (
        <AnnouncementPopup user={currentUser} onClose={() => setShowAnnouncement(false)} />
      )}
      {needsOnboarding && <OnboardingModal currentUser={currentUser} onComplete={() => window.location.reload()} />}
      {showChallengeNotification && !needsOnboarding && (
        <ChallengeNotificationPopup
          currentUser={currentUser}
          onClose={() => setShowChallengeNotification(false)}
        />
      )}
      {/* 🔄 Update Notification */}
      {updateAvailable && <UpdateNotification onUpdate={reloadApp} />}
    </>
  );
};

// -- MAIN APP --
export default function App() {
  const isConversationsRoute = typeof window !== 'undefined' && (
    window.location.pathname === '/conversas' ||
    window.location.pathname === '/admin/conversas' ||
    window.location.hash === '#conversas' ||
    window.location.hash === '#/conversas'
  );

  if (isConversationsRoute) {
    return (
      <AuthProvider>
        <Toaster
          position="top-center"
          richColors
          expand={false}
          closeButton
          toastOptions={{
            style: { fontFamily: 'inherit' },
            className: 'toast-custom',
          }}
        />
        <ConfirmProvider>
          <AdminProtect>
            <Suspense fallback={
              <div className="flex h-screen w-screen items-center justify-center bg-stone-100">
                <Loader2 className="animate-spin text-saibro-600" size={36} />
              </div>
            }>
              <ConversationsStandalonePage />
            </Suspense>
          </AdminProtect>
        </ConfirmProvider>
      </AuthProvider>
    );
  }

  const publicRoute = typeof window !== 'undefined'
    ? getPublicChampionshipRoute(window.location.pathname, window.location.hostname)
    : { type: 'none' as const };

  if (publicRoute.type === 'form-slug') {
    return (
      <AuthProvider>
        <Toaster
          position="top-center"
          richColors
          expand={false}
          closeButton
          toastOptions={{
            style: {
              fontFamily: 'inherit',
            },
            className: 'toast-custom',
          }}
        />
        <PublicFormPage
          slug={publicRoute.slug}
          onBackToApp={() => {
            window.location.href = '/';
          }}
        />
      </AuthProvider>
    );
  }

  if (publicRoute.type !== 'none') {
    return (
      <>
        <Toaster
          position="top-center"
          richColors
          expand={false}
          closeButton
          toastOptions={{
            style: {
              fontFamily: 'inherit',
            },
            className: 'toast-custom',
          }}
        />
        <PublicChampionshipEntry route={publicRoute} />
      </>
    );
  }

  return (
    <AuthProvider>
      <Toaster
        position="top-center"
        richColors
        expand={false}
        closeButton
        toastOptions={{
          style: {
            fontFamily: 'inherit',
          },
          className: 'toast-custom',
        }}
      />
      <ConfirmProvider>
        <AppContent />
      </ConfirmProvider>
    </AuthProvider>
  );
}
