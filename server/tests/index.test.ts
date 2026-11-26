import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildServer, parsePort } from '../src/index.js';

describe('Fastify Server (#36)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('parses PORT with fallback to 3001 on missing or invalid values', () => {
    expect(parsePort(undefined)).toBe(3001);
    expect(parsePort('4500')).toBe(4500);
    expect(parsePort('invalid')).toBe(3001);
    expect(parsePort('0')).toBe(3001);
    expect(parsePort('70000')).toBe(3001);
  });

  it('responds to GET /health with status ok and security headers', async () => {
    app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; timestamp: number }>();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('number');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('configures CORS for the client origin', async () => {
    app = await buildServer({ clientUrl: 'http://localhost:5173' });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('handles WebSocket upgrades at /ws/:roomId and relays chat messages', async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = address.replace('http://', 'ws://');

    const ws1 = new WebSocket(`${wsBase}/ws/room-alpha`);
    const ws2 = new WebSocket(`${wsBase}/ws/room-alpha`);

    await Promise.all([
      new Promise<void>((resolve) => ws1.once('open', () => resolve())),
      new Promise<void>((resolve) => ws2.once('open', () => resolve())),
    ]);

    const received = new Promise<string>((resolve) => {
      ws2.on('message', (data) => {
        const text = data.toString();
        const parsed = JSON.parse(text) as { type: string };
        if (parsed.type === 'chat') {
          resolve(text);
        }
      });
    });

    ws1.send(JSON.stringify({ type: 'chat', data: { ciphertext: 'abc', iv: 'xyz' } }));

    const relayed = JSON.parse(await received) as {
      type: string;
      data: { ciphertext: string; iv: string };
    };
    expect(relayed).toEqual({
      type: 'chat',
      data: { ciphertext: 'abc', iv: 'xyz' },
    });

    ws1.close();
    ws2.close();
  });

  it('routes join, message, key-exchange, and leave protocol types', async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = address.replace('http://', 'ws://');

    const sender = new WebSocket(`${wsBase}/ws/protocol-room`);
    const recipient = new WebSocket(`${wsBase}/ws/protocol-room`);
    let roomInfoCount = 0;
    const firstRoomInfo = new Promise<void>((resolve) => {
      recipient.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { type: string };
        if (parsed.type === 'room_info') {
          roomInfoCount += 1;
          resolve();
        }
      });
    });

    await Promise.all([
      new Promise<void>((resolve) => sender.once('open', () => resolve())),
      new Promise<void>((resolve) => recipient.once('open', () => resolve())),
    ]);
    await firstRoomInfo;

    const receiveType = (socket: WebSocket, type: string): Promise<string> =>
      new Promise((resolve) => {
        socket.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { type: string };
          if (parsed.type === type) resolve(data.toString());
        });
      });

    const roomInfoCountBeforeJoin = roomInfoCount;
    const joinReceived = receiveType(recipient, 'join');
    sender.send(JSON.stringify({ type: 'join', data: { clientId: 'sender' } }));
    expect(JSON.parse(await joinReceived)).toEqual({
      type: 'join',
      data: { clientId: 'sender' },
    });
    expect(roomInfoCount).toBe(roomInfoCountBeforeJoin);

    const messageReceived = receiveType(recipient, 'message');
    sender.send(JSON.stringify({ type: 'message', data: { ciphertext: 'secret', iv: 'iv' } }));
    expect(JSON.parse(await messageReceived)).toEqual({
      type: 'message',
      data: { ciphertext: 'secret', iv: 'iv' },
    });

    const keyReceived = receiveType(recipient, 'key-exchange');
    sender.send(JSON.stringify({ type: 'key-exchange', data: { publicKey: 'key' } }));
    expect(JSON.parse(await keyReceived)).toEqual({
      type: 'key-exchange',
      data: { publicKey: 'key' },
    });

    const leaveReceived = receiveType(recipient, 'leave');
    sender.send(JSON.stringify({ type: 'leave' }));
    expect(JSON.parse(await leaveReceived)).toEqual({ type: 'leave' });

    sender.close();
    recipient.close();
  });

  it('relays stringified encrypted payloads unchanged, as the React client sends them (#15)', async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = address.replace('http://', 'ws://');

    const sender = new WebSocket(`${wsBase}/ws/room-string-payload`);
    const recipient = new WebSocket(`${wsBase}/ws/room-string-payload`);
    await Promise.all([
      new Promise<void>((resolve) => sender.once('open', () => resolve())),
      new Promise<void>((resolve) => recipient.once('open', () => resolve())),
    ]);

    const received = new Promise<string>((resolve) => {
      recipient.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { type: string };
        if (parsed.type === 'chat') resolve(data.toString());
      });
    });

    const encrypted = JSON.stringify({ ciphertext: 'YWJj', iv: 'aXY=' });
    sender.send(JSON.stringify({ type: 'chat', data: encrypted }));

    expect(JSON.parse(await received)).toEqual({ type: 'chat', data: encrypted });

    sender.close();
    recipient.close();
  });

  it('returns a structured error frame for invalid payloads and keeps the connection open (#15)', async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = address.replace('http://', 'ws://');

    const socket = new WebSocket(`${wsBase}/ws/room-invalid-payload`);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));

    const errorFrame = new Promise<unknown>((resolve) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { type: string };
        if (parsed.type === 'error') resolve(parsed);
      });
    });

    socket.send(JSON.stringify({ type: 'chat', data: 'not-an-encrypted-payload' }));

    expect(await errorFrame).toEqual({
      type: 'error',
      code: 'INVALID_SHAPE',
      data: 'Invalid message format',
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('rejects malformed JSON and JSON without a type field', async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = address.replace('http://', 'ws://');
    const socket = new WebSocket(`${wsBase}/ws/validation-room`);

    await new Promise<void>((resolve) => socket.once('open', () => resolve()));

    const firstError = new Promise<string>((resolve) => {
      socket.once('message', (data) => resolve(JSON.parse(data.toString()).data));
    });
    socket.send('{not-json');
    expect(await firstError).toBe('Malformed JSON');

    const secondError = new Promise<string>((resolve) => {
      socket.once('message', (data) => resolve(JSON.parse(data.toString()).data));
    });
    socket.send(JSON.stringify({ data: 'missing type' }));
    expect(await secondError).toBe('Invalid message format');

    socket.close();
  });

  it('closes WebSocket connections to /ws without a room ID using code 4000', async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = address.replace('http://', 'ws://');

    const closeCode = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${wsBase}/ws`);
      ws.on('close', (code) => resolve(code));
    });

    expect(closeCode).toBe(4000);
  });
    
});
