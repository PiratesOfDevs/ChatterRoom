import React from 'react';
import { formatMessageTime, type ChatMessage } from './ChatWindow';

export interface MessageBubbleProps {
  message: ChatMessage;
}

/**
 * Renders a single chat message bubble, aligned right for own messages
 * and left for messages from other participants.
 */
export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const alignment = message.isMine ? 'justify-end' : 'justify-start';
  const bubbleStyles = message.isMine
    ? 'rounded-2xl rounded-br-sm bg-emerald-600 text-white'
    : 'rounded-2xl rounded-bl-sm border border-slate-700 bg-slate-800 text-slate-100';
  const senderStyles = message.isMine ? 'text-emerald-100' : 'text-cyan-300';
  const timeStyles = message.isMine ? 'text-emerald-100/80' : 'text-slate-400';

  return (
    <div className={`flex ${alignment}`}>
      <div className={`max-w-[80%] px-4 py-2 shadow-sm sm:max-w-md ${bubbleStyles}`}>
        <p className={`mb-1 text-xs font-semibold ${senderStyles}`}>
          {message.sender}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {message.content}
        </p>
        <time
          dateTime={new Date(message.timestamp).toISOString()}
          className={`mt-1 block text-right text-[11px] ${timeStyles}`}
        >
          {formatMessageTime(message.timestamp)}
        </time>
      </div>
    </div>
  );
};
