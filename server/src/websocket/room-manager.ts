import type { WebSocket } from 'ws';
import { logger } from '../utils/logger.js';

/**
 * In-memory manager for chat rooms.
 * Rooms are created on first join and destroyed when the last user leaves.
 */
export class RoomManager {
  private rooms: Map<string, Set<WebSocket>> = new Map();

  /**
   * Add a client to a room, creating it if necessary.
   *
   * @param roomId - The room to join
   * @param client - The WebSocket client
   */
  createOrJoin(roomId: string, client: WebSocket): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Set();
      this.rooms.set(roomId, room);
      logger.info(`Room ${roomId} created`);
    }

    room.add(client);
    logger.info(`Client joined room ${roomId} (${room.size} users)`);
  }

  /**
   * Remove a client from a room. Destroys the room if empty.
   *
   * @param roomId - The room to leave
   * @param client - The WebSocket client
   */
  leave(roomId: string, client: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.delete(client);
    logger.info(`Client left room ${roomId} (${room.size} users remaining)`);

    if (room.size === 0) {
      this.rooms.delete(roomId);
      logger.info(`Room ${roomId} destroyed`);
    }
  }

  /**
   * Broadcast a message to room clients, excluding the sender.
   *
   * @param roomId - The room to broadcast in
   * @param message - The serialised message string
   * @param sender - Optional WebSocket to exclude from the broadcast
   */
  broadcast(roomId: string, message: string, sender?: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const client of room) {
      if (client !== sender && client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(message);
      }
    }
  }

  /**
   * Return the number of clients in a room.
   *
   * @param roomId - The room to inspect
   */
  getRoomSize(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  /**
   * Check whether a client is already in a room.
   */
  isClientInRoom(roomId: string, client: WebSocket): boolean {
    return this.rooms.get(roomId)?.has(client) ?? false;
  }

  /**
   * Add a client to a room and notify existing room members of the new count.
   */
  joinRoom(roomId: string, client: WebSocket): void {
    this.createOrJoin(roomId, client);
    this.broadcastRoomInfo(roomId);
  }

  /**
   * Remove a client from a room and notify remaining members of the new count.
   */
  leaveRoom(roomId: string, client: WebSocket): void {
    this.leave(roomId, client);
    this.broadcastRoomInfo(roomId);
  }

  /**
   * Broadcast a message to a room, optionally excluding a client.
   */
  broadcastToRoom(roomId: string, message: string, exclude?: WebSocket): void {
    this.broadcast(roomId, message, exclude);
  }

  private broadcastRoomInfo(roomId: string): void {
    const userCount = this.getRoomSize(roomId);
    if (userCount === 0) return;

    this.broadcast(
      roomId,
      JSON.stringify({
        type: 'room_info',
        data: { userCount },
      }),
    );
  }
}
