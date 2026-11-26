import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { RoomManager } from '../src/websocket/room-manager.js';

const createSocket = (readyState = 1): WebSocket =>
  ({
    readyState,
    send: vi.fn(),
  }) as unknown as WebSocket;

describe('RoomManager', () => {
  it('creates a room on first join and adds clients without duplicates', () => {
    const manager = new RoomManager();
    const client = createSocket();

    manager.createOrJoin('room-a', client);
    manager.createOrJoin('room-a', client);

    expect(manager.getRoomSize('room-a')).toBe(1);
  });

  it('checks whether a client is already in a room', () => {
    const manager = new RoomManager();
    const client = createSocket();

    expect(manager.isClientInRoom('room-a', client)).toBe(false);
    manager.createOrJoin('room-a', client);
    expect(manager.isClientInRoom('room-a', client)).toBe(true);
    expect(manager.isClientInRoom('room-b', client)).toBe(false);
  });

  it('removes clients and destroys the room when the last client leaves', () => {
    const manager = new RoomManager();
    const first = createSocket();
    const second = createSocket();

    manager.createOrJoin('room-a', first);
    manager.createOrJoin('room-a', second);
    manager.leave('room-a', first);

    expect(manager.getRoomSize('room-a')).toBe(1);

    manager.leave('room-a', second);
    expect(manager.getRoomSize('room-a')).toBe(0);

    manager.createOrJoin('room-a', first);
    expect(manager.getRoomSize('room-a')).toBe(1);
  });

  it('broadcasts to open room members other than the sender', () => {
    const manager = new RoomManager();
    const sender = createSocket();
    const recipient = createSocket();
    const closedClient = createSocket(3);

    manager.createOrJoin('room-a', sender);
    manager.createOrJoin('room-a', recipient);
    manager.createOrJoin('room-a', closedClient);

    manager.broadcast('room-a', 'hello', sender);

    expect(sender.send).not.toHaveBeenCalled();
    expect(recipient.send).toHaveBeenCalledOnce();
    expect(recipient.send).toHaveBeenCalledWith('hello');
    expect(closedClient.send).not.toHaveBeenCalled();
  });

  it('returns zero and safely broadcasts for a missing room', () => {
    const manager = new RoomManager();

    expect(manager.getRoomSize('missing')).toBe(0);
    expect(() => manager.broadcast('missing', 'hello')).not.toThrow();
  });
});
