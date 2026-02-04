/**
 * Componente Tooltip Reutilizável
 *
 * Uso:
 * <Tooltip content="Explicação aqui">
 *   <InfoIcon />
 * </Tooltip>
 */

import React, { useState } from 'react';

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  className = '',
  delay = 200,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    const id = setTimeout(() => setIsVisible(true), delay);
    setTimeoutId(id);
  };

  const hideTooltip = () => {
    if (timeoutId) clearTimeout(timeoutId);
    setIsVisible(false);
  };

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-stone-800',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-stone-800',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-stone-800',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-stone-800',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute z-50 px-3 py-2 text-sm text-white bg-stone-800 rounded-lg shadow-lg whitespace-nowrap max-w-xs animate-in fade-in zoom-in-95 duration-200 ${positionClasses[position]} ${className}`}
          role="tooltip"
        >
          {content}
          <div
            className={`absolute w-0 h-0 border-4 border-transparent ${arrowClasses[position]}`}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Tooltip com ícone de informação
 */
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: string | React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  iconSize?: number;
  className?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  position = 'top',
  iconSize = 16,
  className = '',
}) => {
  return (
    <Tooltip content={content} position={position} className={className}>
      <Info size={iconSize} className="text-stone-400 hover:text-stone-600 cursor-help transition-colors" />
    </Tooltip>
  );
};
