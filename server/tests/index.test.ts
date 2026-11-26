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

    it('returns an error frame for invalid payloads and keeps the connection open ', async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = address.replace('http://', 'ws://');

    const ws = new WebSocket(`${wsBase}/ws/room-validate`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));

    const errorFrame = new Promise<{ type: string; code: string }>((resolve) => {
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { type: string; code: string };
        if (parsed.type === 'error') resolve(parsed);
      });
    });

    ws.send(JSON.stringify({ type: 'chat', data: 'not-an-object' }));

    expect(await errorFrame).toEqual({ type: 'error', code: 'INVALID_SHAPE' });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
