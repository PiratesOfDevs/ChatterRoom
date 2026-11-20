import { toArrayBuffer } from './buffer.js';

/**
 * Convert a hex string to a Uint8Array.
 *
 * @param hex - Hex-encoded string
 * @returns Decoded byte array
 */
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
};

/**
 * Derive an AES-256-GCM key from raw key material using HKDF (SHA-256).
 *
 * @param rawKeyMaterial - The raw key material as a Uint8Array
 * @param salt - Optional salt for HKDF (defaults to empty)
 * @param info - Optional context/info string for HKDF (defaults to 'chatterroom-key')
 * @returns A promise that resolves to a derived AES-GCM CryptoKey
 *
 * @example
 * ```ts
 * const material = new TextEncoder().encode('my-secret');
 * const key = await deriveKey(material);
 * ```
 */
export const deriveKey = async (
  rawKeyMaterial: Uint8Array,
  salt: Uint8Array = new Uint8Array(0),
  info: string = 'chatterroom-key',
): Promise<CryptoKey> => {
  // Import raw key material as HKDF base key
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawKeyMaterial),
    'HKDF',
    false,
    ['deriveKey'],
  );

  // Derive the final AES-256-GCM key using HKDF
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(new TextEncoder().encode(info)),
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false, // non-extractable for security
    ['encrypt', 'decrypt'],
  );

  return derivedKey;
};

/**
 * Derive an AES-256-GCM room key from a hex-encoded URL hash string.
 *
 * This is the primary function used by the client to turn the URL fragment
 * into a usable encryption key. Because the hash fragment is never sent to
 * the server, only participants who have the full link can decrypt messages.
 *
 * @param hashHex - The hex-encoded key string from the URL hash fragment
 * @returns A promise that resolves to a derived AES-GCM CryptoKey
 *
 * @example
 * ```ts
 * const key = await deriveRoomKeyFromHash(location.hash.slice(1));
 * ```
 */
export const deriveRoomKeyFromHash = async (hashHex: string): Promise<CryptoKey> => {
  const rawBytes = hexToBytes(hashHex);
  return deriveKey(rawBytes, new Uint8Array(0), 'chatterroom-room-key');
};

/**
 * Export an ECDH public key to JWK format for transmission.
 *
 * @param publicKey - The CryptoKey to export
 * @returns A promise that resolves to the JWK representation
 *
 * @example
 * ```ts
 * const { publicKey } = await generateECDHKeyPair();
 * const jwk = await exportPublicKey(publicKey);
 * // Send `jwk` to the other party
 * ```
 */
export const exportPublicKey = async (publicKey: CryptoKey): Promise<JsonWebKey> => {
  return crypto.subtle.exportKey('jwk', publicKey);
};

/**
 * Import an ECDH public key from JWK format received from another party.
 *
 * @param jwk - The JWK representation of the public key
 * @returns A promise that resolves to the imported CryptoKey
 *
 * @example
 * ```ts
 * const remotePublicKey = await importPublicKey(receivedJwk);
 * const shared = await deriveSharedSecret(myPrivateKey, remotePublicKey);
 * ```
 */
export const importPublicKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true, // extractable so it can be re-exported if needed
    [],   // public keys have no usages for ECDH — the private key drives deriveKey
  );
};
