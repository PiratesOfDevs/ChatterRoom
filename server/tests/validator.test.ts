import { describe, it, expect } from 'vitest';
import {
  validateIncoming,
  MAX_FRAME_BYTES,
  MAX_IV_LENGTH,
  MAX_KEY_EXCHANGE_DATA_LENGTH,
} from '../src/websocket/validator.js';

const frame = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const chat = (data: unknown): Buffer => frame({ type: 'chat', data });

describe('validateIncoming: valid frames', () => {
  it('accepts join', () => {
    expect(validateIncoming(frame({ type: 'join' }))).toEqual({
      ok: true,
      message: { type: 'join' },
    });
  });

  it('accepts chat with an encrypted payload', () => {
    expect(validateIncoming(chat({ ciphertext: 'abc', iv: 'xyz' }))).toEqual({
      ok: true,
      message: { type: 'chat', data: { ciphertext: 'abc', iv: 'xyz' } },
    });
  });

  it('accepts key-exchange at the size limit', () => {
    const data = 'a'.repeat(MAX_KEY_EXCHANGE_DATA_LENGTH);
    expect(validateIncoming(frame({ type: 'key-exchange', data }))).toEqual({
      ok: true,
      message: { type: 'key-exchange', data },
    });
  });
});

describe('validateIncoming: invalid shapes', () => {
  const cases: Array<[string, Buffer]> = [
    ['empty object', frame({})],
    ['unknown type', frame({ type: 'nope' })],
    ['non-string type', frame({ type: 5 })],
    ['the old "message" type', frame({ type: 'message', data: { ciphertext: 'a', iv: 'b' } })],
    ['chat without data', frame({ type: 'chat' })],
    ['chat with string data', chat('abc')],
    ['chat with null data', chat(null)],
    ['chat with array data', chat([])],
    ['chat missing iv', chat({ ciphertext: 'abc' })],
    ['chat missing ciphertext', chat({ iv: 'xyz' })],
    ['chat with empty ciphertext', chat({ ciphertext: '', iv: 'xyz' })],
    ['chat with non-string iv', chat({ ciphertext: 'abc', iv: 5 })],
    ['chat with iv over its cap', chat({ ciphertext: 'abc', iv: 'a'.repeat(MAX_IV_LENGTH + 1) })],
    ['chat with extra key in data', chat({ ciphertext: 'abc', iv: 'xyz', extra: 1 })],
    ['chat with extra top-level key', frame({ type: 'chat', data: { ciphertext: 'a', iv: 'b' }, roomId: 'x' })],
    ['join with extra key', frame({ type: 'join', extra: true })],
    ['key-exchange without data', frame({ type: 'key-exchange' })],
    ['key-exchange over its cap', frame({ type: 'key-exchange', data: 'a'.repeat(MAX_KEY_EXCHANGE_DATA_LENGTH + 1) })],
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