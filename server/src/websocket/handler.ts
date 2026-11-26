import type { WebSocket } from 'ws';
import type { FastifyRequest } from 'fastify';
import { RoomManager } from './room-manager.js';
import { checkRateLimit } from '../middleware/rate-limiter.js';
import { logger } from '../utils/logger.js';
import { startHeartbeat } from './heartbeat.js';
import { validateIncoming, type ClientMessage, type ValidationErrorCode } from './validator.js';

const roomManager = new RoomManager();
const leftSockets = new WeakSet<WebSocket>();

/** Human-readable text for each validation error. Never includes client input. */
const ERROR_MESSAGES: Record<ValidationErrorCode, string> = {
  INVALID_JSON: 'Malformed JSON',
  INVALID_SHAPE: 'Invalid message format',
  PAYLOAD_TOO_LARGE: 'Payload too large',
};

const sendError = (socket: WebSocket, message: string, code?: ValidationErrorCode): void => {
  if (socket.readyState === socket.OPEN) {
    const frame =
      code === undefined
        ? { type: 'error', data: message }
        : { type: 'error', code, data: message };
    socket.send(JSON.stringify(frame));
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

  socket.on('message', (raw: Buffer, isBinary: boolean) => {
    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      sendError(socket, 'Rate limit exceeded');
      return;
    }

    // Validate size, JSON and exact shape before anything is relayed
    const result = validateIncoming(raw, isBinary);
    if (!result.ok) {
      sendError(socket, ERROR_MESSAGES[result.code], result.code);
      return;
    }

    onMessage(roomId, socket, result.message);
  });

  socket.on('close', () => {
    onClose(roomId, socket);
  });

  socket.on('error', (err) => {
    logger.error(`WebSocket error in room ${roomId}:`, err);
  });
};

/**
 * Handle a validated message from a client.
 *
 * @param roomId - The room the message was sent in
 * @param sender - The sending WebSocket
 * @param message - The validated message
 */
export const onMessage = (roomId: string, sender: WebSocket, message: ClientMessage): void => {
  switch (message.type) {
    case 'join':
      if (!roomManager.isClientInRoom(roomId, sender)) {
        roomManager.joinRoom(roomId, sender);
        leftSockets.delete(sender);
      }
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    case 'message':
    case 'key-exchange':
      // Relay encrypted payloads and key material without inspecting or storing them.
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    case 'leave':
      if (!leftSockets.has(sender)) {
        leftSockets.add(sender);
        roomManager.leaveRoom(roomId, sender);
        roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      }
      break;
    case 'chat':
      // Backward-compatible alias for the original chat message protocol.
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    default: {
      const unreachable: never = message;
      void unreachable;
    }
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