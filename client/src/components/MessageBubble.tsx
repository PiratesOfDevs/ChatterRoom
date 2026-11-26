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
  const bubbleStyles = message.isMine
      ? 'rounded-2xl rounded-br-sm border border-amber-400/50 bg-amber-500 text-[#0B111A] shadow-sm'
      : 'rounded-2xl rounded-bl-sm border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-800 dark:bg-[#131C2B] dark:text-slate-100';
    const senderStyles = message.isMine
      ? 'text-[#0B111A]/85'
      : 'text-amber-700 dark:text-amber-400';
    const timeStyles = message.isMine
      ? 'text-[#0B111A]/80 font-medium'
      : 'text-slate-600 dark:text-slate-300';

    return (
      <div className={`flex ${alignment} transition-all duration-200`}>
        <div className={`max-w-[80%] px-4 py-2 transition-colors duration-200 sm:max-w-md ${bubbleStyles}`}>
          <p className={`mb-1 text-xs font-semibold ${senderStyles}`}>
            {message.sender}
          </p>
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