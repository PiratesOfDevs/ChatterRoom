import React, { useState } from 'react';

export interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

/**
 * Text input field with a send button for composing messages.
 */
export const MessageInput: React.FC<MessageInputProps> = ({ onSend, disabled = false }) => {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="chat-message-input flex gap-2 border-t border-slate-300 bg-white p-3 transition-colors duration-300 dark:border-amber-500/20 dark:bg-[#131C2B] sm:p-4"
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Send a message across the deck…"
        disabled={disabled}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-base text-slate-900 placeholder-slate-500 outline-none transition-all duration-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40 dark:border-slate-700 dark:bg-[#0B111A] dark:text-slate-100 dark:placeholder-slate-400 dark:focus:border-amber-400 dark:focus:ring-amber-400/40 sm:px-4"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="min-h-11 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-[#0B111A] transition-all duration-200 hover:bg-amber-400 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
      >
        Send
      </button>
    </form>
  );
};