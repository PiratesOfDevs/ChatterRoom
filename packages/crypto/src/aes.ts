import { toArrayBuffer } from './buffer.js';

/** Length of the AES-GCM initialization vector in bytes. */
const IV_LENGTH = 12;

/**
 * Payload returned by {@link aesEncrypt} containing everything
 * needed to decrypt the ciphertext.
 */
export interface AESEncryptedPayload {
  /** Base64-encoded ciphertext (includes the GCM auth tag). */
  ciphertext: string;
  /** Base64-encoded initialization vector. */
  iv: string;
}

/**
 * Convert an ArrayBuffer to a base64 string.
 *
 * @param buffer - The buffer to encode
 * @returns Base64-encoded string
 */
const bufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

/**
 * Convert a base64 string back to an ArrayBuffer.
 *
 * @param base64 - The base64 string to decode
 * @returns Decoded ArrayBuffer
 */
const base64ToBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Encrypt plaintext data using AES-256-GCM.
 *
 * A random 12-byte initialization vector (IV) is generated for each
 * encryption operation to ensure semantic security. The IV is returned
 * alongside the ciphertext and must be provided during decryption.
 *
 * @param key - An AES-GCM CryptoKey (256-bit)
 * @param data - The plaintext data to encrypt as a Uint8Array
 * @returns A promise that resolves to the encrypted payload
 *
 * @example
 * ```ts
 * const plaintext = new TextEncoder().encode('Hello, world!');
 * const payload = await aesEncrypt(aesKey, plaintext);
 * // payload.ciphertext and payload.iv are base64 strings
 * ```
 */
export const aesEncrypt = async (
  key: CryptoKey,
  data: Uint8Array,
): Promise<AESEncryptedPayload> => {
  // Generate a random IV for this encryption
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    key,
    toArrayBuffer(data),
  );

  return {
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv.buffer),
  };
};

/**
 * Decrypt an AES-256-GCM encrypted payload back to plaintext.
 *
 * @param key - The same AES-GCM CryptoKey used for encryption
 * @param payload - The encrypted payload containing ciphertext and IV
 * @returns A promise that resolves to the decrypted data as a Uint8Array
 * @throws Will throw if the key is incorrect or the ciphertext has been tampered with
 *
 * @example
 * ```ts
 * const decrypted = await aesDecrypt(aesKey, payload);
 * const plaintext = new TextDecoder().decode(decrypted);
 * ```
 */
export const aesDecrypt = async (
  key: CryptoKey,
  payload: AESEncryptedPayload,
): Promise<Uint8Array> => {
  const ciphertext = base64ToBuffer(payload.ciphertext);
  const iv = base64ToBuffer(payload.iv);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    ciphertext,
  );

  return new Uint8Array(decrypted);
};
