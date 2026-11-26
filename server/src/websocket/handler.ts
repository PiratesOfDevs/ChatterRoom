import type { WebSocket } from 'ws';
import type { FastifyRequest } from 'fastify';
import { RoomManager } from './room-manager.js';
import { checkRateLimit } from '../middleware/rate-limiter.js';
import { logger } from '../utils/logger.js';
import { startHeartbeat } from './heartbeat.js';

const roomManager = new RoomManager();
const leftSockets = new WeakSet<WebSocket>();

interface IncomingMessage {
  type: string;
  roomId?: string;
  data?: unknown;
}

const sendError = (socket: WebSocket, message: string): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: 'error', data: message }));
  }
};

/**
 * Handle a new WebSocket connection.
 *
 * @param socket - The WebSocket connection
 * @param req - The originating Fastify request
 */
export const handleWebSocketConnection = (socket: WebSocket, req: FastifyRequest): void => {
  const paramRoomId = (req.params as { roomId?: string } | undefined)?.roomId;
  const url = new URL(req.url, 'http://localhost');
  const roomId = paramRoomId || url.searchParams.get('room');
  const clientIp = req.ip;

  if (!roomId) {
    socket.close(4000, 'Missing room ID');
    return;
  }

  logger.info(`Client connected to room ${roomId} from ${clientIp}`);
  roomManager.joinRoom(roomId, socket);
  startHeartbeat(socket);

  socket.on('message', (raw: Buffer) => {
    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      sendError(socket, 'Rate limit exceeded');
      return;
    }

    try {
      const parsed: unknown = JSON.parse(raw.toString());
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('type' in parsed) ||
        typeof parsed.type !== 'string' ||
        parsed.type.trim().length === 0
      ) {
        logger.warn(`Invalid message format from ${clientIp}`);
        sendError(socket, 'Invalid message format');
        return;
      }

      const message = parsed as IncomingMessage;
      onMessage(roomId, socket, message);
    } catch {
      logger.warn(`Malformed message from ${clientIp}`);
      sendError(socket, 'Malformed JSON');
    }
  });

  socket.on('close', () => {
    onClose(roomId, socket);
  });

  socket.on('error', (err) => {
    logger.error(`WebSocket error in room ${roomId}:`, err);
  });
};

/**
 * Handle an incoming message from a client.
 *
 * @param roomId - The room the message was sent in
 * @param sender - The sending WebSocket
 * @param message - The parsed message payload
 */
export const onMessage = (roomId: string, sender: WebSocket, message: IncomingMessage): void => {
  switch (message.type) {
    case 'join':
      roomManager.joinRoom(roomId, sender);
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    case 'message':
    case 'key-exchange':
      // Relay encrypted payloads and key material without inspecting or storing them.
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    case 'leave':
      leftSockets.add(sender);
      roomManager.leaveRoom(roomId, sender);
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    case 'chat':
      // Backward-compatible alias for the original chat message protocol.
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    default:
      logger.warn(`Unknown message type: ${message.type}`);
      sendError(sender, `Unknown message type: ${message.type}`);
  }
};

/**
 * Handle a client disconnecting from a room.
 *
 * @param roomId - The room the client was in
 * @param socket - The disconnecting WebSocket
 */
export const onClose = (roomId: string, socket: WebSocket): void => {
  logger.info(`Client disconnected from room ${roomId}`);
  if (!leftSockets.has(socket)) {
    roomManager.leaveRoom(roomId, socket);
  }
  leftSockets.delete(socket);
};
