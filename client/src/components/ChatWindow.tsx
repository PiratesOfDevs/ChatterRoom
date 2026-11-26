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
      className="chat-message-feed min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4"
    >
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-4 text-center">
          <p className="text-base font-medium text-slate-300">No messages yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Send a message to start chatting!
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
