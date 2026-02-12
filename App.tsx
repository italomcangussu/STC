import React, { useState, useEffect } from 'react';
import { Trophy, Loader2, X, Megaphone } from 'lucide-react';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { Klanches } from './components/Klanches';
import { Championships } from './components/Championships';
import { Athletes } from './components/Athletes';
import { Ranking } from './components/Ranking';
import { Agenda } from './components/Agenda';
import { ProfessorProfile } from './components/ProfessorProfile';
import { AdminProfessors } from './components/AdminProfessors';
import { AdminPanel } from './components/AdminPanel';
import { FinanceiroAdmin } from './components/FinanceiroAdmin';
import { ChallengesView } from './components/Challenges';
import { SuperSet } from './components/SuperSet';
import { AdminStudents } from './components/AdminStudents';
import { ChampionshipAdmin } from './components/ChampionshipAdmin';
import { AdminProtect } from './components/AdminProtect';
import { Auth } from './components/Auth';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { User } from './types';
import { supabase } from './lib/supabase';

import { OnboardingModal } from './components/OnboardingModal';
import { ChallengeNotificationPopup } from './components/ChallengeNotificationPopup';
import { PublicChampionshipPage } from './components/PublicChampionshipPage';

interface Announcement {
  id: string;
  title: string;
  message: string;
  imageUrl: string | null;
  showOnce: boolean;
}

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
  const [view, setView] = useState('agenda');
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const [targetAthleteId, setTargetAthleteId] = useState<string | null>(null);
  const [showChallengeNotification, setShowChallengeNotification] = useState(true);

  const handleOpenProfile = (userId: string) => {
    setTargetAthleteId(userId);
    setView('atletas');
  };

  /* Routing for Public Championship Pages */
  // Simple router based on pathname for Public Slug
  const [publicSlug, setPublicSlug] = useState<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    if (path !== '/' && path !== '' && !path.includes('.')) {
      // Assume it is a slug
      const slug = path.substring(1);
      setPublicSlug(slug);
    }
  }, []);

  if (publicSlug) {
    return <PublicChampionshipPage slug={publicSlug} />;
  }

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
      <Layout view={view} setView={setView} currentUser={currentUser} onLogout={signOut}>
        <div key={view} className="animate-page-enter">
          {view === 'agenda' && <Agenda currentUser={currentUser} />}
          {view === 'dashboard' && <Dashboard />}
          {view === 'klanches' && <Klanches currentUser={currentUser} />}
          {view === 'desafios' && <ChallengesView currentUser={currentUser} />}
          {view === 'superset' && <SuperSet />}
          {view === 'campeonatos' && <Championships currentUser={currentUser} />}
          {view === 'competicao' && <Championships currentUser={currentUser} />}
          {view === 'atletas' && <Athletes initialUserId={targetAthleteId} currentUser={currentUser} onClearRequest={() => setTargetAthleteId(null)} />}
          {view === 'perfil' && <Athletes initialUserId={currentUser.id} currentUser={currentUser} onClearRequest={() => setView('dashboard')} />}
          {view === 'ranking' && <Ranking onSelectProfile={handleOpenProfile} />}
          {view === 'professor' && <ProfessorProfile currentUser={currentUser} />}
          {view === 'admin-students' && <AdminProtect><AdminStudents /></AdminProtect>}
          {view === 'admin-professors' && <AdminProtect><AdminProfessors /></AdminProtect>}
          {view === 'admin-panel' && <AdminProtect><AdminPanel /></AdminProtect>}
          {view === 'financeiro-admin' && <AdminProtect><FinanceiroAdmin /></AdminProtect>}
          {view === 'championship-admin' && <AdminProtect><ChampionshipAdmin currentUser={currentUser} /></AdminProtect>}
        </div>
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
    </>
  );
};

// -- MAIN APP --
export default function App() {
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
      <AppContent />
    </AuthProvider>
  );
}