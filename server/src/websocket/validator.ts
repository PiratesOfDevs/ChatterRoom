/** Maximum size of a whole incoming frame, in bytes. */
export const MAX_FRAME_BYTES = 64 * 1024;
/** AES-GCM IVs are 12 bytes (16 base64 characters); allow some headroom. */
export const MAX_IV_LENGTH = 64;
/** key-exchange data: a public key as a string, or a small object such as a JWK. */
export const MAX_KEY_EXCHANGE_DATA_LENGTH = 4 * 1024;
/** join/leave metadata, for example a client id. */
export const MAX_PRESENCE_DATA_LENGTH = 1024;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ENVELOPE_KEYS = ['type', 'data', 'timestamp'] as const;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
}

/** Encrypted data: a {ciphertext, iv} object, or the same object JSON-encoded as a string. */
export type EncryptedData = EncryptedPayload | string;

/** Small opaque data: a non-empty string or a non-empty plain object. */
export type OpaqueData = string | Record<string, unknown>;

interface Envelope {
  timestamp?: number;
}

export type ClientMessage =
  | ({ type: 'chat' | 'message'; data: EncryptedData } & Envelope)
  | ({ type: 'key-exchange'; data: OpaqueData } & Envelope)
  | ({ type: 'join' | 'leave'; data?: OpaqueData } & Envelope);

export type ValidationErrorCode = 'PAYLOAD_TOO_LARGE' | 'INVALID_JSON' | 'INVALID_SHAPE';

export type ValidationResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ValidationErrorCode };

const fail = (code: ValidationErrorCode): ValidationResult => ({ ok: false, code });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (obj: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(obj).every((key) => allowed.includes(key));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Exactly {ciphertext, iv}, both base64, iv bounded. */
const isEncryptedPayload = (value: unknown): value is EncryptedPayload => {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['ciphertext', 'iv'])) return false;
  const { ciphertext, iv } = value;
  return (
    typeof ciphertext === 'string' &&
    BASE64_PATTERN.test(ciphertext) &&
    typeof iv === 'string' &&
    iv.length <= MAX_IV_LENGTH &&
    BASE64_PATTERN.test(iv)
  );
};

/** An encrypted payload as an object, or as a JSON string that decodes to exactly one. */
const isEncryptedData = (value: unknown): value is EncryptedData => {
  if (typeof value !== 'string') return isEncryptedPayload(value);
  try {
    return isEncryptedPayload(JSON.parse(value));
  } catch {
    return false;
  }
};

/** A non-empty string, or a non-empty plain object, within the size limit. */
const isBoundedOpaqueData = (value: unknown, maxLength: number): value is OpaqueData => {
  if (typeof value === 'string') return value.length > 0 && value.length <= maxLength;
  if (!isPlainObject(value) || Object.keys(value).length === 0) return false;
  return JSON.stringify(value).length <= maxLength;
};

const encrypted = (type: 'chat' | 'message', data: unknown, envelope: Envelope): ValidationResult =>
  isEncryptedData(data) ? { ok: true, message: { type, data, ...envelope } } : fail('INVALID_SHAPE');

const keyExchange = (data: unknown, envelope: Envelope): ValidationResult =>
  isBoundedOpaqueData(data, MAX_KEY_EXCHANGE_DATA_LENGTH)
    ? { ok: true, message: { type: 'key-exchange', data, ...envelope } }
    : fail('INVALID_SHAPE');

const presence = (type: 'join' | 'leave', data: unknown, envelope: Envelope): ValidationResult => {
  if (data === undefined) return { ok: true, message: { type, ...envelope } };
  return isBoundedOpaqueData(data, MAX_PRESENCE_DATA_LENGTH)
    ? { ok: true, message: { type, data, ...envelope } }
    : fail('INVALID_SHAPE');
};

/**
 * Validate one raw incoming WebSocket frame.
 * Never reads or logs the encrypted contents; checks type, shape and size only.
 * The returned message keeps `data` in the form the client sent it (object or string),
 * and contains only allowlisted fields, so nothing unvalidated is relayed.
 *
 * @param raw - The raw frame bytes
 * @param isBinary - Whether the frame was a binary frame (rejected; text only)
 * @returns A typed message on success, or an error code on failure
 */
export const validateIncoming = (raw: Buffer, isBinary = false): ValidationResult => {
  if (isBinary) return fail('INVALID_SHAPE');
  if (raw.byteLength > MAX_FRAME_BYTES) return fail('PAYLOAD_TOO_LARGE');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return fail('INVALID_JSON');
  }
  if (!isPlainObject(parsed) || !hasOnlyKeys(parsed, ENVELOPE_KEYS)) return fail('INVALID_SHAPE');

  const { type, data, timestamp } = parsed;
  if (timestamp !== undefined && !isFiniteNumber(timestamp)) return fail('INVALID_SHAPE');
  const envelope: Envelope = isFiniteNumber(timestamp) ? { timestamp } : {};

  switch (type) {
    case 'chat':
      return encrypted('chat', data, envelope);
    case 'message':
      return encrypted('message', data, envelope);
    case 'key-exchange':
      return keyExchange(data, envelope);
    case 'join':
      return presence('join', data, envelope);
    case 'leave':
      return presence('leave', data, envelope);
    default:
      return fail('INVALID_SHAPE');
  }
};