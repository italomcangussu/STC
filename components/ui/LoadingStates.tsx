/**
 * Componentes Reutilizáveis de Loading States
 *
 * Uso:
 * <LoadingSpinner size="sm" />
 * <SkeletonCard />
 * <LoadingOverlay message="Carregando reservas..." />
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

// --- LOADING SPINNER ---
interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', className = '' }) => {
  const sizeMap = {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 32,
    xl: 48,
  };

  return (
    <Loader2
      className={`animate-spin text-saibro-600 ${className}`}
      size={sizeMap[size]}
    />
  );
};

// --- LOADING OVERLAY ---
interface LoadingOverlayProps {
  message?: string;
  transparent?: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  message = 'Carregando...',
  transparent = false,
}) => {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        transparent ? 'bg-black/10' : 'bg-white/90'
      } backdrop-blur-sm animate-in fade-in duration-200`}
    >
      <div className="flex flex-col items-center space-y-4">
        <LoadingSpinner size="xl" />
        {message && <p className="text-stone-600 font-medium">{message}</p>}
      </div>
    </div>
  );
};

// --- SKELETON CARD ---
export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`bg-white rounded-2xl shadow-sm p-4 space-y-3 ${className}`}>
      <div className="h-4 bg-stone-200 rounded animate-pulse w-3/4" />
      <div className="h-4 bg-stone-200 rounded animate-pulse w-1/2" />
      <div className="h-4 bg-stone-200 rounded animate-pulse w-5/6" />
    </div>
  );
};

// --- SKELETON LIST ---
interface SkeletonListProps {
  count?: number;
  className?: string;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({ count = 3, className = '' }) => {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
};

// --- SKELETON TEXT ---
interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export const SkeletonText: React.FC<SkeletonTextProps> = ({ lines = 3, className = '' }) => {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-stone-200 rounded animate-pulse"
          style={{ width: `${100 - Math.random() * 30}%` }}
        />
      ))}
    </div>
  );
};

// --- SKELETON AVATAR ---
export const SkeletonAvatar: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const sizeMap = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  return <div className={`${sizeMap[size]} bg-stone-200 rounded-full animate-pulse`} />;
};

// --- SHIMMER EFFECT ---
export const Shimmer: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
};

// --- LOADING CONTAINER ---
interface LoadingContainerProps {
  loading: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  overlay?: boolean;
  message?: string;
}

export const LoadingContainer: React.FC<LoadingContainerProps> = ({
  loading,
  children,
  fallback,
  overlay = false,
  message,
}) => {
  if (!loading) return <>{children}</>;

  if (overlay) {
    return (
      <>
        {children}
        <LoadingOverlay message={message} transparent />
      </>
    );
  }

  return <>{fallback || <SkeletonList />}</>;
};

// --- INLINE SPINNER ---
interface InlineSpinnerProps {
  text?: string;
  className?: string;
}

export const InlineSpinner: React.FC<InlineSpinnerProps> = ({ text, className = '' }) => {
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <LoadingSpinner size="sm" />
      {text && <span className="text-stone-600 text-sm">{text}</span>}
    </div>
  );
};

// --- BUTTON LOADING STATE ---
interface LoadingButtonProps {
  loading: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  loading,
  children,
  onClick,
  className = '',
  disabled = false,
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`relative ${className} ${loading || disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      )}
      <span className={loading ? 'invisible' : ''}>{children}</span>
    </button>
  );
};

// Adicionar ao CSS global (index.css) a animação shimmer:
/*
@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}
*/
