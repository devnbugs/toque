/**
 * Nusuk portal encryption utilities.
 *
 * The Nusuk portal (masar.nusuk.sa) encrypts the login authorization header
 * and the otpTimeStamp using AES-128-CBC with a static key and zero IV.
 * The key is fetched from the `common-config/key-part` endpoint and stored
 * in localStorage as `userPreferences`, with `l` and `m` characters removed.
 *
 * This module reimplements the encryption using Node.js native crypto so
 * the auto-login flow can generate valid headers without a browser.
 */

import { createCipheriv, createDecipheriv } from "crypto";

// Default key — from the Nusuk portal's `common-config/key-part` endpoint.
// The raw value is "yabcLMdexM201M72L3KDSM"; after removing l/m (case-insensitive)
// it becomes "yabcdex201723KDS" (16 bytes = AES-128).
const DEFAULT_KEY = "yabcdex201723KDS";

// Static IV of all zeros (16 bytes).
const IV = Buffer.alloc(16, 0);

/**
 * Encrypt a string using AES-128-CBC with PKCS7 padding.
 * @param {string} plaintext - The text to encrypt.
 * @param {string} [key] - The AES key (16/24/32 bytes). Defaults to the Nusuk key.
 * @returns {string} Base64-encoded ciphertext (CryptoJS-compatible).
 */
export function nusukEncrypt(plaintext, key = DEFAULT_KEY) {
  const keyBuffer = Buffer.from(key, "utf8");
  const cipher = createCipheriv("aes-128-cbc", keyBuffer, IV);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return encrypted.toString("base64");
}

/**
 * Encrypt a string and URL-encode the result (matches the portal's `encryptURI`).
 * Used for the `authorization` header in the login request.
 * @param {string} plaintext - The text to encrypt.
 * @param {string} [key] - The AES key. Defaults to the Nusuk key.
 * @returns {string} URL-encoded Base64 ciphertext.
 */
export function nusukEncryptURI(plaintext, key = DEFAULT_KEY) {
  return encodeURIComponent(nusukEncrypt(plaintext, key));
}

/**
 * Decrypt a Base64-encoded AES-128-CBC ciphertext.
 * @param {string} ciphertext - Base64-encoded ciphertext.
 * @param {string} [key] - The AES key. Defaults to the Nusuk key.
 * @returns {string} Decrypted plaintext.
 */
export function nusukDecrypt(ciphertext, key = DEFAULT_KEY) {
  const keyBuffer = Buffer.from(key, "utf8");
  const decipher = createDecipheriv("aes-128-cbc", keyBuffer, IV);
  const decrypted = Buffer.concat([decipher.update(ciphertext, "base64"), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Generate the `authorization` header for the login request.
 * The portal does: encryptURI("Basic " + btoa(username + ":" + password))
 * @param {string} username - The login username (email).
 * @param {string} password - The login password.
 * @param {string} [key] - The AES key. Defaults to the Nusuk key.
 * @returns {string} The encrypted, URL-encoded authorization header value.
 */
export function buildLoginAuthorization(username, password, key = DEFAULT_KEY) {
  const credentials = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return nusukEncryptURI(`Basic ${credentials}`, key);
}

/**
 * Generate a random secret string matching the portal's `generateSecret(f)`.
 * Format: 2 random digits + f random special chars (&*@$) + 2 random letters.
 * @param {number} specialCount - Number of special characters (2 for login, 3 for other flows).
 * @returns {string} The generated secret.
 */
export function generateSecret(specialCount = 2) {
  const digits = "0123456789";
  const specials = "&*@$";
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  // 2 random digits
  for (let i = 0; i < 2; i++) {
    result += digits[Math.floor(Math.random() * 10)];
  }
  // specialCount random special chars
  for (let i = 0; i < specialCount; i++) {
    result += specials[Math.floor(Math.random() * 4)];
  }
  // 2 random letters
  for (let i = 0; i < 2; i++) {
    result += letters[Math.floor(Math.random() * 52)];
  }
  return result;
}

/**
 * Generate the `otpTimeStamp` for the login request.
 * The portal does: btoa(encrypt(generateSecret(2) + "-" + Date.now()))
 * @param {string} [key] - The AES key. Defaults to the Nusuk key.
 * @returns {string} Base64-encoded encrypted OTP timestamp.
 */
export function buildOtpTimeStamp(key = DEFAULT_KEY) {
  const secret = generateSecret(2);
  const timestamp = Date.now();
  const plaintext = `${secret}-${timestamp}`;
  const encrypted = nusukEncrypt(plaintext, key);
  return Buffer.from(encrypted, "utf8").toString("base64");
}

/**
 * Build the complete login payload and headers.
 * @param {object} params
 * @param {string} params.username - Login username (email).
 * @param {string} params.password - Login password.
 * @param {string} [params.captchaToken] - Solved reCAPTCHA token.
 * @param {string} [params.key] - AES key (defaults to Nusuk key).
 * @param {string} [params.xChannel] - X-Channel header value.
 * @param {string} [params.trustedDeviceToken] - trusteddevicetoken header value.
 * @returns {{payload: object, headers: object}} The login payload and headers.
 */
export function buildLoginRequest({ username, password, captchaToken, key, xChannel, trustedDeviceToken }) {
  const authorization = buildLoginAuthorization(username, password, key);
  const otpTimeStamp = buildOtpTimeStamp(key);

  const payload = {
    captchaResponse: captchaToken || "",
    otpTimeStamp,
  };

  const headers = {
    "X-Lang": "en",
    "X-Channel": xChannel || "ZlEW8G0jE195d1hY+hvN6/0T9KljTFeVg798I3V1t6I=",
    authorization,
  };

  if (trustedDeviceToken) {
    headers["trusteddevicetoken"] = trustedDeviceToken;
  }

  return { payload, headers };
}
