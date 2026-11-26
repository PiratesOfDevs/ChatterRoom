import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Generates a cryptographically random hex string to use as a room key.
 * @param length - Number of random bytes (default 32 for 256-bit key)
 * @returns Hex-encoded random string
 */
const generateRandomKey = (length = 32): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Generates a random room ID.
 * @returns A short random room identifier
 */
const generateRoomId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Landing page component.
 * Provides a "Create Room" button that generates a new room with a
 * cryptographic key embedded in the URL hash fragment.
 */
export const Home: React.FC = () => {
  const navigate = useNavigate();

  const handleCreateRoom = () => {
    const roomId = generateRoomId();
    const key = generateRandomKey();
    navigate(`/room/${roomId}#${key}`);
  };

  return (
  <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-900 transition-colors duration-300 dark:bg-[#0B111A] dark:text-slate-100">
    <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white/95 p-8 text-center shadow-xl transition-all duration-300 dark:border-amber-500/20 dark:bg-[#131C2B]/95">
      <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/15 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-3.5 w-3.5"
        >
          <circle cx="12" cy="5" r="3" />
          <line x1="12" y1="22" x2="12" y2="8" />
          <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
        </svg>
        <span>Encrypted Deck</span>
      </div>

      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
        🏴‍☠️ Chatter<span className="text-amber-600 dark:text-amber-400">Room</span>
      </h1>

      <p className="mb-8 text-base text-slate-600 transition-colors duration-200 dark:text-slate-300 sm:text-lg">
        End-to-end encrypted chat. No sign-up required.
      </p>

      <button
        type="button"
        onClick={handleCreateRoom}
        className="rounded-lg bg-amber-500 px-8 py-3 text-lg font-semibold text-[#0B111A] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-400 active:translate-y-0 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#131C2B]"
      >
        Create Room
      </button>
    </div>
  </div>  );
};
