import React from 'react';
import type { ChatMessage } from './ChatWindow';

export interface MessageBubbleProps {
  message: ChatMessage;
}

/**
 * Renders a single chat message bubble, aligned left or right depending
 * on whether it was sent by the current user.
 */
export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const alignment = message.isMine ? 'justify-end' : 'justify-start';
  const bubbleStyle = message.isMine
    ? 'bg-amber-500 text-[#0B111A] border border-amber-400/50 shadow-sm'
    : 'bg-white text-slate-900 border border-slate-200 dark:bg-[#131C2B] dark:text-slate-100 dark:border-slate-800';

  return (
    <div className={`mb-2.5 flex ${alignment} transition-all duration-200`}>
      <div className={`max-w-xs rounded-xl px-4 py-2.5 transition-colors duration-200 ${bubbleStyle}`}>
        {!message.isMine && (
          <p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {message.sender}
          </p>
        )}
        <p className="text-sm leading-relaxed">{message.content}</p>
        <p
          className={`mt-1 text-right text-xs ${
            message.isMine
              ? 'text-slate-900/80 font-medium'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
};