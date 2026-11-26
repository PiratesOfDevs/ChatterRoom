import React, { useEffect, useRef } from 'react';
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
  const settledUserCountRef = useRef<number | null>(null);
  const systemNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    settledUserCountRef.current = null;
    if (systemNoticeTimerRef.current) {
      clearTimeout(systemNoticeTimerRef.current);
      systemNoticeTimerRef.current = null;
    }
    return () => {
      if (systemNoticeTimerRef.current) {
        clearTimeout(systemNoticeTimerRef.current);
        systemNoticeTimerRef.current = null;
      }
    };
  }, [roomId]);

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

            if (settledUserCountRef.current === null) {
              settledUserCountRef.current = count;
              return;
            }

            if (systemNoticeTimerRef.current) {
              clearTimeout(systemNoticeTimerRef.current);
            }

            // Debounce join/leave notices to ignore rapid StrictMode / reconnect churn
            systemNoticeTimerRef.current = setTimeout(() => {
              const settled = settledUserCountRef.current;
              if (settled !== null && count !== settled) {
                addMessage({
                  id: crypto.randomUUID(),
                  sender: 'System',
                  content: count > settled ? 'A user joined the room' : 'A user left the room',
                  timestamp: Date.now(),
                  isMine: false,
                  type: 'system',
                });
                settledUserCountRef.current = count;
              }
              systemNoticeTimerRef.current = null;
            }, 300);
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
    <div className="chat-room flex flex-col bg-gray-900 text-white">
      <RoomHeader
        roomId={roomId}
        userCount={userCount}
        isEncrypted={cryptoReady}
        onLeave={handleLeave}
      />
      <ChatWindow messages={messages} />
      <MessageInput onSend={handleSend} disabled={connectionStatus !== 'connected'} />
    </div>
  );
};
