import React from 'react';

export interface RoomHeaderProps {
  roomId: string;
  userCount: number;
  isEncrypted?: boolean;
  onLeave?: () => void;
}

const AnchorEmblem: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <circle cx="12" cy="5" r="3" />
    <line x1="12" y1="22" x2="12" y2="8" />
    <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
  </svg>
);

const SkullEmblem: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <path d="M8 20v2h8v-2" />
    <path d="m12.5 17-.5-1-.5 1h1z" />
    <path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
  </svg>
);

/**
 * Header bar for a chat room displaying the room name, connected user count,
 * encryption status, and a button to copy the room link to the clipboard.
 */
export const RoomHeader: React.FC<RoomHeaderProps> = ({
  roomId,
  userCount,
  isEncrypted = true,
  onLeave,
}) => {
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // Fallback: ignore if clipboard API unavailable
    }
  };

  return (
    <header className="flex items-center justify-between border-b border-slate-300 bg-white/95 px-3 py-2 text-slate-900 transition-colors duration-300 dark:border-amber-500/20 dark:bg-[#131C2B]/95 dark:text-slate-100 sm:px-6 sm:py-3">
      <div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-700 transition-transform duration-200 hover:rotate-12 dark:text-amber-400"
          >
            <SkullEmblem className="h-4 w-4" />
          </span>
          <h2 className="text-base font-bold tracking-wide sm:text-lg">
            🏴‍☠️ Room {roomId.slice(0, 8)}
          </h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors duration-200 ${
              isEncrypted
                ? 'border border-emerald-700/50 bg-emerald-950/60 text-emerald-300'
                : 'border border-amber-700/50 bg-amber-950/60 text-amber-300'
            }`}
          >
            {isEncrypted ? '🔒 E2E Encrypted' : '⏳ Initializing…'}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
          <AnchorEmblem className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span>
            {userCount} crewmate{userCount !== 1 ? 's' : ''} online
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleCopyLink}
          className="min-h-9 rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 transition-all duration-200 hover:border-amber-500/50 hover:bg-amber-500/15 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-slate-700 dark:bg-[#0B111A] dark:text-slate-100 dark:hover:border-amber-400/50 dark:hover:bg-amber-500/15 dark:hover:text-amber-300 sm:px-4 sm:py-1 sm:text-sm"
        >
          Copy Link
        </button>
        {onLeave && (
          <button
            type="button"
            onClick={onLeave}
            className="min-h-9 rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white transition-all duration-200 hover:bg-red-600 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:bg-red-600 dark:hover:bg-red-500 sm:px-4 sm:py-1 sm:text-sm"
          >
            Leave Room
          </button>
        )}
      </div>
    </header>
  );
};