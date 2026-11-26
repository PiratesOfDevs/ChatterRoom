import React from 'react';
import { ChatWindow } from './ChatWindow.js';
import { MessageInput } from './MessageInput.js';
import { RoomHeader } from './RoomHeader.js';

interface ChatRoomProps {
  roomId: string;
}

/**
 * ChatRoom Container Component
 * Coordinates RoomHeader, ChatWindow, and MessageInput.
 */
export const ChatRoom: React.FC<ChatRoomProps> = ({ roomId }) => {
  return (
    <div data-theme="pirate" className="flex flex-col h-screen bg-slate-100 text-slate-900 dark:bg-[#0B111A] dark:text-slate-100 transition-colors duration-300 selection:bg-amber-500/30 selection:text-amber-200">
      <RoomHeader roomId={roomId} userCount={1} />
      <div className="flex-1 overflow-hidden p-4 bg-gradient-to-b from-transparent to-amber-500/[0.02] dark:to-amber-400/[0.03] transition-colors duration-300">
        <ChatWindow messages={[]} />
      </div>
      <div className="p-4 border-t border-slate-300 dark:border-amber-500/20 bg-white/90 dark:bg-[#131C2B]/90 backdrop-blur-sm transition-colors duration-300">
        <MessageInput onSend={(content: string) => console.log('Send message:', content)} />
      </div>
    </div>
  );
};
