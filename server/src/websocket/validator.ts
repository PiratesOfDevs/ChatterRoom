/** Maximum size of a whole incoming frame, in bytes. */
export const MAX_FRAME_BYTES = 64 * 1024;
/** An AES-GCM IV is 12 to 16 bytes, so a few dozen characters is plenty. */
export const MAX_IV_LENGTH = 64;
/** key-exchange only carries a public key, so it gets a much smaller cap. */
export const MAX_KEY_EXCHANGE_DATA_LENGTH = 2 * 1024;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
}

export type ClientMessage =
  | { type: 'join' }
  | { type: 'chat'; data: EncryptedPayload }
  | { type: 'key-exchange'; data: string };

export type ValidationErrorCode = 'PAYLOAD_TOO_LARGE' | 'INVALID_JSON' | 'INVALID_SHAPE';

export type ValidationResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ValidationErrorCode };

const fail = (code: ValidationErrorCode): ValidationResult => ({ ok: false, code });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (obj: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(obj).every((key) => allowed.includes(key));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Validate the encrypted payload object; returns null if it is not exactly {ciphertext, iv}. */
const parseEncryptedPayload = (value: unknown): EncryptedPayload | null => {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['ciphertext', 'iv'])) return null;
  const { ciphertext, iv } = value;
  if (!isNonEmptyString(ciphertext) || !isNonEmptyString(iv)) return null;
  if (iv.length > MAX_IV_LENGTH) return null;
  return { ciphertext, iv };
};

/**
 * Validate one raw incoming WebSocket frame.
 * Never inspects or logs the encrypted contents; checks type, shape and size only.
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
  if (!isPlainObject(parsed)) return fail('INVALID_SHAPE');

  switch (parsed.type) {
    case 'join':
      return hasOnlyKeys(parsed, ['type'])
        ? { ok: true, message: { type: 'join' } }
        : fail('INVALID_SHAPE');

    case 'chat': {
      if (!hasOnlyKeys(parsed, ['type', 'data'])) return fail('INVALID_SHAPE');
      const data = parseEncryptedPayload(parsed.data);
      return data ? { ok: true, message: { type: 'chat', data } } : fail('INVALID_SHAPE');
    }

    case 'key-exchange':
      return hasOnlyKeys(parsed, ['type', 'data']) &&
        isNonEmptyString(parsed.data) &&
        parsed.data.length <= MAX_KEY_EXCHANGE_DATA_LENGTH
        ? { ok: true, message: { type: 'key-exchange', data: parsed.data } }
        : fail('INVALID_SHAPE');

    default:
      return fail('INVALID_SHAPE');
  }
};