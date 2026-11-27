import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';

/** Represents a single chat or system message. */
export interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  isMine: boolean;
  type?: 'chat' | 'system';
}

export interface ChatWindowProps {
  messages: ChatMessage[];
}

/**
 * Format a Unix timestamp (ms) into 24-hour HH:MM format.
 */
export const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

/**
 * Scroll the bottom sentinel into view, respecting reduced-motion preferences.
 */
export const scrollToLatestMessage = (
  target: Pick<HTMLElement, 'scrollIntoView'> | null,
): void => {
  if (!target || typeof target.scrollIntoView !== 'function') return;

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  target.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'end',
  });
};

/**
 * Displays a scrollable list of chat and system messages,
 * auto-scrolling to the latest message as new ones arrive.
 */
export const ChatWindow: React.FC<ChatWindowProps> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToLatestMessage(bottomRef.current);
    }
  }, [messages.length]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      className="chat-message-feed min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl bg-slate-50/70 p-3 text-slate-900 transition-colors duration-300 dark:bg-[#0B111A] dark:text-slate-100 sm:p-4"
      >
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="mb-2 h-6 w-6 text-amber-600 dark:text-amber-400"
          >
            <circle cx="12" cy="5" r="3" />
            <line x1="12" y1="22" x2="12" y2="8" />
            <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
          </svg>
          <p className="text-base font-medium text-slate-800 dark:text-slate-200">
            No messages yet.
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Weigh anchor and send a message to start chatting!
          </p>
       </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {messages.map((msg) =>
            msg.type === 'system' ? (
              <div key={msg.id} className="my-2 flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-800/80 px-3 py-1 text-xs text-slate-400">
                  <span>{msg.content}</span>
                  <time
                    dateTime={new Date(msg.timestamp).toISOString()}
                    className="text-[11px] text-slate-500"
                  >
                    {formatMessageTime(msg.timestamp)}
                  </time>
                </div>
              </div>
            ) : (
              <MessageBubble key={msg.id} message={msg} />
            ),
          )}
          <div ref={bottomRef} aria-hidden="true" />
        </div>
      )}
    </div>
  );
};