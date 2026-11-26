import { describe, it, expect } from 'vitest';
import {
  validateIncoming,
  MAX_FRAME_BYTES,
  MAX_IV_LENGTH,
  MAX_KEY_EXCHANGE_DATA_LENGTH,
  MAX_PRESENCE_DATA_LENGTH,
} from '../src/websocket/validator.js';

const frame = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const payload = { ciphertext: 'YWJj', iv: 'aXY=' };
const encoded = JSON.stringify(payload);

describe('validateIncoming: valid frames', () => {
  it.each(['chat', 'message'])('accepts %s with an object payload', (type) => {
    expect(validateIncoming(frame({ type, data: payload }))).toEqual({
      ok: true,
      message: { type, data: payload },
    });
  });

  it.each(['chat', 'message'])('accepts %s with a JSON-string payload and keeps it a string', (type) => {
    const result = validateIncoming(frame({ type, data: encoded }));
    expect(result).toEqual({ ok: true, message: { type, data: encoded } });
  });

  it('accepts key-exchange as a string, a key object and a JWK-style object', () => {
    expect(validateIncoming(frame({ type: 'key-exchange', data: 'abc' })).ok).toBe(true);
    expect(validateIncoming(frame({ type: 'key-exchange', data: { publicKey: 'key' } })).ok).toBe(true);
    expect(
      validateIncoming(
        frame({ type: 'key-exchange', data: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b', key_ops: [] } }),
      ).ok,
    ).toBe(true);
  });

  it('accepts key-exchange string at the size limit', () => {
    const data = 'a'.repeat(MAX_KEY_EXCHANGE_DATA_LENGTH);
    expect(validateIncoming(frame({ type: 'key-exchange', data }))).toEqual({
      ok: true,
      message: { type: 'key-exchange', data },
    });
  });

  it.each(['join', 'leave'])('accepts %s without data', (type) => {
    expect(validateIncoming(frame({ type }))).toEqual({ ok: true, message: { type } });
  });

  it.each(['join', 'leave'])('accepts %s with object or string data', (type) => {
    expect(validateIncoming(frame({ type, data: { clientId: 'sender' } }))).toEqual({
      ok: true,
      message: { type, data: { clientId: 'sender' } },
    });
    expect(validateIncoming(frame({ type, data: 'client-1' })).ok).toBe(true);
  });

  it('keeps a finite timestamp', () => {
    expect(validateIncoming(frame({ type: 'leave', timestamp: 1700000000000 }))).toEqual({
      ok: true,
      message: { type: 'leave', timestamp: 1700000000000 },
    });
  });

  it('drops nothing legitimate and adds nothing', () => {
    const result = validateIncoming(frame({ type: 'chat', data: payload, timestamp: 5 }));
    expect(result).toEqual({ ok: true, message: { type: 'chat', data: payload, timestamp: 5 } });
  });
});

describe('validateIncoming: invalid shapes', () => {
  const cases: Array<[string, Buffer]> = [
    ['empty object', frame({})],
    ['unknown type', frame({ type: 'nope' })],
    ['non-string type', frame({ type: 5 })],
    ['extra top-level key', frame({ type: 'chat', data: payload, roomId: 'x' })],
    ['chat without data', frame({ type: 'chat' })],
    ['chat with null data', frame({ type: 'chat', data: null })],
    ['chat with array data', frame({ type: 'chat', data: [] })],
    ['chat with numeric data', frame({ type: 'chat', data: 5 })],
    ['chat with non-JSON string', frame({ type: 'chat', data: 'not-an-encrypted-payload' })],
    ['chat with JSON string of a string', frame({ type: 'chat', data: JSON.stringify('abc') })],
    ['chat with JSON string of an array', frame({ type: 'chat', data: '[]' })],
    ['chat with double-encoded payload', frame({ type: 'chat', data: JSON.stringify(encoded) })],
    ['chat with string payload missing iv', frame({ type: 'chat', data: JSON.stringify({ ciphertext: 'YWJj' }) })],
    ['chat with string payload extra key', frame({ type: 'chat', data: JSON.stringify({ ...payload, extra: 1 }) })],
    ['message missing iv', frame({ type: 'message', data: { ciphertext: 'YWJj' } })],
    ['message missing ciphertext', frame({ type: 'message', data: { iv: 'aXY=' } })],
    ['empty ciphertext', frame({ type: 'chat', data: { ciphertext: '', iv: 'aXY=' } })],
    ['non-string iv', frame({ type: 'chat', data: { ciphertext: 'YWJj', iv: 5 } })],
    ['non-base64 ciphertext', frame({ type: 'chat', data: { ciphertext: 'not base64!', iv: 'aXY=' } })],
    ['iv over its cap', frame({ type: 'chat', data: { ciphertext: 'YWJj', iv: 'A'.repeat(MAX_IV_LENGTH + 1) } })],
    ['extra key inside data', frame({ type: 'chat', data: { ...payload, extra: 1 } })],
    ['key-exchange without data', frame({ type: 'key-exchange' })],
    ['key-exchange with number', frame({ type: 'key-exchange', data: 5 })],
    ['key-exchange with empty object', frame({ type: 'key-exchange', data: {} })],
    ['key-exchange string over cap', frame({ type: 'key-exchange', data: 'a'.repeat(MAX_KEY_EXCHANGE_DATA_LENGTH + 1) })],
    ['key-exchange object over cap', frame({ type: 'key-exchange', data: { publicKey: 'a'.repeat(MAX_KEY_EXCHANGE_DATA_LENGTH) } })],
    ['join with null data', frame({ type: 'join', data: null })],
    ['join with array data', frame({ type: 'join', data: [] })],
    ['join with empty string', frame({ type: 'join', data: '' })],
    ['join with empty object', frame({ type: 'join', data: {} })],
    ['join string over cap', frame({ type: 'join', data: 'a'.repeat(MAX_PRESENCE_DATA_LENGTH + 1) })],
    ['leave object over cap', frame({ type: 'leave', data: { id: 'a'.repeat(MAX_PRESENCE_DATA_LENGTH) } })],
    ['join with extra key', frame({ type: 'join', extra: true })],
    ['timestamp as string', frame({ type: 'leave', timestamp: 'now' })],
    ['timestamp null (NaN or Infinity)', frame({ type: 'leave', timestamp: null })],
    ['array', Buffer.from('[]')],
    ['null', Buffer.from('null')],
    ['number', Buffer.from('42')],
    ['string', Buffer.from('"hi"')],
    ['__proto__ key', Buffer.from('{"type":"join","__proto__":{"admin":true}}')],
  ];

  it.each(cases)('rejects %s', (_name, raw) => {
    expect(validateIncoming(raw)).toEqual({ ok: false, code: 'INVALID_SHAPE' });
  });

  it('rejects binary frames', () => {
    expect(validateIncoming(frame({ type: 'join' }), true)).toEqual({
      ok: false,
      code: 'INVALID_SHAPE',
    });
  });
});

describe('validateIncoming: bad input', () => {
  it('rejects invalid JSON', () => {
    expect(validateIncoming(Buffer.from('{not json'))).toEqual({ ok: false, code: 'INVALID_JSON' });
  });

  it('rejects an empty frame', () => {
    expect(validateIncoming(Buffer.alloc(0))).toEqual({ ok: false, code: 'INVALID_JSON' });
  });

  it('rejects oversized frames before parsing', () => {
    const raw = Buffer.alloc(MAX_FRAME_BYTES + 1, 'a');
    expect(validateIncoming(raw)).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
  });
});