/**
 * Orientation & Fullscreen Hook
 * Detects landscape/portrait, manages Fullscreen API
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface OrientationState {
  isLandscape: boolean;
  isPortrait: boolean;
  isFullscreen: boolean;
  isMobile: boolean;
}

export function useOrientation() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [state, setState] = useState<OrientationState>(() => ({
    isLandscape: typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false,
    isPortrait: typeof window !== 'undefined' ? window.innerWidth <= window.innerHeight : true,
    isFullscreen: false,
    isMobile: typeof navigator !== 'undefined' ? ('ontouchstart' in window || navigator.maxTouchPoints > 0) : false,
  }));

  // Listen for orientation and resize changes
  useEffect(() => {
    const update = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      const isFullscreen = !!document.fullscreenElement;
      setState(prev => {
        if (prev.isLandscape === isLandscape && prev.isFullscreen === isFullscreen) return prev;
        return {
          ...prev,
          isLandscape,
          isPortrait: !isLandscape,
          isFullscreen,
        };
      });
    };

    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', update);

    // Also listen to screen.orientation if available
    const orientationApi = screen.orientation;
    if (orientationApi) {
      orientationApi.addEventListener('change', update);
    }

    update();

    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', update);
      if (orientationApi) {
        orientationApi.removeEventListener('change', update);
      }
    };
  }, []);

  const requestFullscreen = useCallback(async () => {
    try {
      const el = containerRef.current || document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
      // Try to lock orientation to landscape
      try {
        await screen.orientation.lock('landscape');
      } catch {
        // Not all browsers support orientation lock
      }
    } catch {
      // Fullscreen not supported or denied
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      try {
        screen.orientation.unlock();
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }, []);

  return {
    ...state,
    containerRef,
    requestFullscreen,
    exitFullscreen,
  };
}
