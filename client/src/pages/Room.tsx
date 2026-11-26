import React, { useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ChatWindow } from '../components/ChatWindow';
import { MessageInput } from '../components/MessageInput';
import { RoomHeader } from '../components/RoomHeader';
import { observeChatViewport } from '../lib/chatViewport.js';
import { useWebSocket } from '../hooks/useWebSocket';
import { useCrypto } from '../hooks/useCrypto';
import { useRoom } from '../hooks/useRoom';

interface ServerMessage {
  type: string;
  data?: unknown;
}

/**
 * Chat room page.
 * Extracts the room ID from the URL path and the encryption key from the
 * URL hash fragment, then initialises WebSocket and crypto hooks.
 */
export const Room: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    return observeChatViewport(document.documentElement.style, window);
  }, []);

  // The key lives in the hash fragment so it's never sent to the server
  const encryptionKey = location.hash.slice(1);

  const { keys, encrypt, decrypt, isReady: cryptoReady } = useCrypto(encryptionKey);
  const { sendMessage, connectionStatus, lastMessage } = useWebSocket(roomId ?? '');
  const { messages, userCount, addMessage, setUserCount, clearMessages } = useRoom();

  useEffect(() => {
    if (!lastMessage) return;

    let cancelled = false;
    const handleIncoming = async () => {
      try {
        const parsed = JSON.parse(lastMessage) as ServerMessage;
        if (parsed.type === 'room_info' && parsed.data && typeof parsed.data === 'object') {
          const count = (parsed.data as { userCount?: unknown }).userCount;
          if (typeof count === 'number') {
            setUserCount(count);
          }
          return;
        }

        if (parsed.type === 'chat' && typeof parsed.data === 'string' && cryptoReady) {
          const plaintext = await decrypt(parsed.data);
          if (!cancelled) {
            addMessage({
              id: crypto.randomUUID(),
              sender: 'Peer',
              content: plaintext,
              timestamp: Date.now(),
              isMine: false,
            });
          }
        }
      } catch {
        // Ignore malformed or undecryptable payloads
      }
    };

    void handleIncoming();
    return () => {
      cancelled = true;
    };
  }, [lastMessage, cryptoReady, decrypt, addMessage, setUserCount]);

  const handleSend = async (plaintext: string) => {
    if (!cryptoReady || !keys) return;
    const encrypted = await encrypt(plaintext);
    sendMessage(JSON.stringify({ type: 'chat', data: encrypted }));
    addMessage({
      id: crypto.randomUUID(),
      sender: 'You',
      content: plaintext,
      timestamp: Date.now(),
      isMine: true,
    });
  };

  const handleLeave = () => {
    clearMessages();
    navigate('/');
  };

  if (!roomId || !encryptionKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
        <p className="text-red-400">Invalid room link.</p>
      </div>
    );
  }
  

  return (
    <div className="chat-room flex min-h-screen flex-col bg-slate-100 text-slate-900 transition-colors duration-300 dark:bg-[#0B111A] dark:text-slate-100">
        <RoomHeader
          roomId={roomId}
          userCount={userCount}
          isEncrypted={cryptoReady}
          onLeave={handleLeave}
        />
        <ChatWindow messages={messages} />
        <MessageInput onSend={handleSend} disabled={connectionStatus !== 'connected'} />
    </div>  );
};
