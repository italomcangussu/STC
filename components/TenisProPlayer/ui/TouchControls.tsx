/**
 * Mobile Touch Controls (HTML Overlay)
 * Landscape-optimized layout with visual feedback
 */

import React, { useRef, useCallback, useState } from 'react';
import type { ShotType } from '../constants';
import type { JoystickState } from '../engine/usePlayerInput';

interface TouchControlsProps {
  joystickRef: React.MutableRefObject<JoystickState>;
  onJoystickStart: (x: number, y: number, touchId: number) => void;
  onJoystickMove: (x: number, y: number, touchId: number) => void;
  onJoystickEnd: (touchId: number) => void;
  onShotStart: (type: ShotType, touchId: number) => void;
  onShotEnd: (touchId: number) => void;
  isLandscape: boolean;
}

interface ActiveShots {
  normal: boolean;
  lob: boolean;
  slice: boolean;
}

export const TouchControls: React.FC<TouchControlsProps> = ({
  joystickRef,
  onJoystickStart, onJoystickMove, onJoystickEnd,
  onShotStart, onShotEnd,
  isLandscape,
}) => {
  const joystickAreaRef = useRef<HTMLDivElement>(null);
  const [activeShots, setActiveShots] = useState<ActiveShots>({ normal: false, lob: false, slice: false });

  const handleJoystickTouch = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.changedTouches[0];
    if (!touch) return;
    const rect = joystickAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (e.type === 'touchstart') onJoystickStart(x, y, touch.identifier);
    else if (e.type === 'touchmove') onJoystickMove(x, y, touch.identifier);
    else onJoystickEnd(touch.identifier);
  }, [onJoystickStart, onJoystickMove, onJoystickEnd]);

  const handleShotTouch = useCallback((type: ShotType) => (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.changedTouches[0];
    if (!touch) return;
    if (e.type === 'touchstart') {
      onShotStart(type, touch.identifier);
      setActiveShots(prev => ({ ...prev, [type]: true }));
    } else {
      onShotEnd(touch.identifier);
      setActiveShots(prev => ({ ...prev, [type]: false }));
    }
  }, [onShotStart, onShotEnd]);

  const js = joystickRef.current;

  // Button sizes and layout adapt to landscape/portrait
  const hitSize = isLandscape ? 'w-20 h-20' : 'w-16 h-16';
  const secSize = isLandscape ? 'w-16 h-16' : 'w-14 h-14';
  const btnGap = isLandscape ? 'gap-4' : 'gap-3';
  const joystickHeight = isLandscape ? '60%' : '45%';

  // Shot buttons container positioning
  const shotContainerClass = isLandscape
    ? 'absolute right-6 bottom-[15%] flex flex-col items-center pointer-events-auto'
    : 'absolute right-4 bottom-[10%] flex flex-col items-center pointer-events-auto';

  return (
    <div className="absolute inset-0 z-20 pointer-events-none" style={{ touchAction: 'none' }}>
      {/* Joystick area (left half, bottom) */}
      <div
        ref={joystickAreaRef}
        className="absolute left-0 bottom-0 pointer-events-auto"
        style={{
          width: isLandscape ? '40%' : '50%',
          height: joystickHeight,
          touchAction: 'none',
        }}
        onTouchStart={handleJoystickTouch}
        onTouchMove={handleJoystickTouch}
        onTouchEnd={handleJoystickTouch}
        onTouchCancel={handleJoystickTouch}
      >
        {/* Joystick idle indicator */}
        {!js.active && (
          <div
            className="absolute rounded-full border-2 border-white/15 bg-white/5 flex items-center justify-center"
            style={{
              width: isLandscape ? 90 : 70,
              height: isLandscape ? 90 : 70,
              left: isLandscape ? '25%' : '20%',
              bottom: isLandscape ? '30%' : '25%',
            }}
          >
            <div
              className="rounded-full bg-white/20"
              style={{ width: isLandscape ? 40 : 30, height: isLandscape ? 40 : 30 }}
            />
          </div>
        )}

        {/* Active joystick */}
        {js.active && (
          <>
            {/* Outer ring */}
            <div
              className="absolute rounded-full border-2 border-white/25 bg-white/5"
              style={{
                width: isLandscape ? 140 : 120,
                height: isLandscape ? 140 : 120,
                left: js.startX - (isLandscape ? 70 : 60),
                top: js.startY - (isLandscape ? 70 : 60),
              }}
            />
            {/* Inner knob */}
            <div
              className="absolute rounded-full bg-white/30 border-2 border-white/50 shadow-lg shadow-white/10"
              style={{
                width: isLandscape ? 60 : 50,
                height: isLandscape ? 60 : 50,
                left: js.currentX - (isLandscape ? 30 : 25),
                top: js.currentY - (isLandscape ? 30 : 25),
              }}
            />
          </>
        )}

        <span
          className="absolute text-white/20 text-[10px] font-bold tracking-widest"
          style={{ left: isLandscape ? '25%' : '20%', bottom: isLandscape ? '12%' : '8%' }}
        >
          MOVER
        </span>
      </div>

      {/* Shot buttons */}
      <div className={`${shotContainerClass} ${btnGap}`} style={{ touchAction: 'none' }}>
        {/* LOB button */}
        <div
          className={`${secSize} rounded-full border-2 flex items-center justify-center transition-all duration-100 shadow-lg ${
            activeShots.lob
              ? 'bg-blue-500/50 border-blue-300/70 scale-110 shadow-blue-500/30'
              : 'bg-blue-500/20 border-blue-400/40 shadow-blue-500/10'
          }`}
          onTouchStart={handleShotTouch('lob')}
          onTouchEnd={handleShotTouch('lob')}
          onTouchCancel={handleShotTouch('lob')}
        >
          <div className="text-center">
            <div className="text-blue-300 text-[10px] font-black">LOB</div>
            <div className="text-blue-300/60 text-[8px]">↑</div>
          </div>
          {/* Glow ring */}
          {activeShots.lob && (
            <div className="absolute inset-0 rounded-full border-2 border-blue-300/50 animate-ping" />
          )}
        </div>

        {/* HIT button (larger, center) */}
        <div
          className={`${hitSize} rounded-full border-2 flex items-center justify-center transition-all duration-100 shadow-lg ${
            activeShots.normal
              ? 'bg-green-500/50 border-green-300/70 scale-110 shadow-green-500/40'
              : 'bg-green-500/25 border-green-400/50 shadow-green-500/20'
          }`}
          onTouchStart={handleShotTouch('normal')}
          onTouchEnd={handleShotTouch('normal')}
          onTouchCancel={handleShotTouch('normal')}
        >
          <span className="text-green-300 text-sm font-black">HIT</span>
          {activeShots.normal && (
            <div className="absolute inset-0 rounded-full border-2 border-green-300/50 animate-ping" />
          )}
        </div>

        {/* SLICE button */}
        <div
          className={`${secSize} rounded-full border-2 flex items-center justify-center transition-all duration-100 shadow-lg ${
            activeShots.slice
              ? 'bg-orange-500/50 border-orange-300/70 scale-110 shadow-orange-500/30'
              : 'bg-orange-500/20 border-orange-400/40 shadow-orange-500/10'
          }`}
          onTouchStart={handleShotTouch('slice')}
          onTouchEnd={handleShotTouch('slice')}
          onTouchCancel={handleShotTouch('slice')}
        >
          <div className="text-center">
            <div className="text-orange-300 text-[10px] font-black">SLICE</div>
            <div className="text-orange-300/60 text-[8px]">↘</div>
          </div>
          {activeShots.slice && (
            <div className="absolute inset-0 rounded-full border-2 border-orange-300/50 animate-ping" />
          )}
        </div>
      </div>
    </div>
  );
};
