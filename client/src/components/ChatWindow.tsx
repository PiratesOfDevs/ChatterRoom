import React from 'react';
import { MessageBubble } from './MessageBubble';

/** Represents a single chat message. */
export interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  isMine: boolean;
}

export interface ChatWindowProps {
  messages: ChatMessage[];
}

/**
 * Displays a scrollable list of chat messages.
 */
export const ChatWindow: React.FC<ChatWindowProps> = ({ messages }) => {
  return (
    <div className="chat-message-feed min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl bg-slate-50/70 p-3 text-slate-900 transition-colors duration-300 dark:bg-[#0B111A] dark:text-slate-100 sm:p-4">
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center py-10 text-center">
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
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No messages yet. Weigh anchor and start the conversation!
          </p>
        </div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}
    </div>
  );
};