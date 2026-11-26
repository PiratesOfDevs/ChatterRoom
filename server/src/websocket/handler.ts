import type { WebSocket } from 'ws';
import type { FastifyRequest } from 'fastify';
import { RoomManager } from './room-manager.js';
import { checkRateLimit } from '../middleware/rate-limiter.js';
import { logger } from '../utils/logger.js';
import { startHeartbeat } from './heartbeat.js';
import { validateIncoming, type ClientMessage, type ValidationErrorCode } from './validator.js';

const roomManager = new RoomManager();

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
      socket.send(JSON.stringify({ type: 'error', data: 'Rate limit exceeded' }));
      return;
    }

    // Validate shape and size before anything is relayed
    const result = validateIncoming(raw, isBinary);
    if (!result.ok) {
      sendError(socket, result.code);
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
 * Send a structured error frame to a client.
 * Carries only an error code, never the offending payload.
 *
 * @param socket - The client to notify
 * @param code - The validation error code
 */
const sendError = (socket: WebSocket, code: ValidationErrorCode): void => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: 'error', code }));
  }
};

/**
 * Handle a validated message from a client.
 *
 * @param roomId - The room the message was sent in
 * @param sender - The sending WebSocket
 * @param message - The validated message
 */
const onMessage = (roomId: string, sender: WebSocket, message: ClientMessage): void => {
  switch (message.type) {
    case 'chat':
    case 'key-exchange':
      // Relay the validated frame (re-serialised, so nothing unvalidated rides along)
      roomManager.broadcastToRoom(roomId, JSON.stringify(message), sender);
      break;
    case 'join':
      // The room is joined at connect time from the URL; nothing to do yet.
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
const onClose = (roomId: string, socket: WebSocket): void => {
  logger.info(`Client disconnected from room ${roomId}`);
  roomManager.leaveRoom(roomId, socket);
};