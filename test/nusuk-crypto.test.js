import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nusukEncrypt,
  nusukEncryptURI,
  nusukDecrypt,
  buildLoginAuthorization,
  generateSecret,
  buildOtpTimeStamp,
  buildLoginRequest,
} from "../src/nusuk-crypto.js";

const DEFAULT_KEY = "yabcdex201723KDS";

test("nusukEncrypt produces valid base64 ciphertext", () => {
  const encrypted = nusukEncrypt("Basic dGVzdDp0ZXN0");
  assert.equal(typeof encrypted, "string");
  assert.ok(encrypted.length > 0);
  // Should be valid base64
  assert.doesNotThrow(() => Buffer.from(encrypted, "base64"));
});

test("nusukEncrypt and nusukDecrypt are inverse operations", () => {
  const plaintext = "Hello World 123";
  const encrypted = nusukEncrypt(plaintext);
  const decrypted = nusukDecrypt(encrypted);
  assert.equal(decrypted, plaintext);
});

test("nusukEncryptURI URL-encodes the ciphertext", () => {
  const encrypted = nusukEncryptURI("Basic dGVzdDp0ZXN0");
  // URL-encoded: + becomes %2B, / becomes %2F, = becomes %3D
  assert.ok(!encrypted.includes("+") || encrypted.includes("%2B"));
  assert.equal(encrypted, encodeURIComponent(nusukEncrypt("Basic dGVzdDp0ZXN0")));
});

test("nusukEncrypt uses AES-128-CBC with zero IV (deterministic)", () => {
  const plaintext = "test";
  const enc1 = nusukEncrypt(plaintext);
  const enc2 = nusukEncrypt(plaintext);
  // Same key + same IV + same plaintext = same ciphertext
  assert.equal(enc1, enc2);
});

test("nusukEncrypt with different keys produces different ciphertext", () => {
  const plaintext = "test";
  const enc1 = nusukEncrypt(plaintext, DEFAULT_KEY);
  const enc2 = nusukEncrypt(plaintext, "0123456789abcdef");
  assert.notEqual(enc1, enc2);
});

test("buildLoginAuthorization encrypts Basic + btoa(username:password)", () => {
  const auth = buildLoginAuthorization("user@test.com", "pass123");
  assert.equal(typeof auth, "string");
  assert.ok(auth.length > 0);
  // Should be URL-encoded
  assert.ok(!auth.includes("/") || auth.includes("%2F"));
  // Decrypt to verify
  const decoded = decodeURIComponent(auth);
  const decrypted = nusukDecrypt(decoded);
  const expected = `Basic ${Buffer.from("user@test.com:pass123").toString("base64")}`;
  assert.equal(decrypted, expected);
});

test("generateSecret produces correct format", () => {
  for (let i = 0; i < 100; i++) {
    const secret = generateSecret(2);
    // 2 digits + 2 special chars + 2 letters = 6 chars
    assert.equal(secret.length, 6);
    // First 2 chars are digits
    assert.ok(/[0-9]{2}/.test(secret.substring(0, 2)));
    // Last 2 chars are letters
    assert.ok(/[a-zA-Z]{2}/.test(secret.substring(4)));
  }
});

test("generateSecret with 3 special chars produces 7 chars", () => {
  const secret = generateSecret(3);
  assert.equal(secret.length, 7);
});

test("buildOtpTimeStamp produces valid base64 of encrypted timestamp", () => {
  const otp = buildOtpTimeStamp();
  assert.equal(typeof otp, "string");
  assert.ok(otp.length > 0);
  // It's btoa(encrypted_string), so decode once to get the encrypted string
  const encryptedStr = Buffer.from(otp, "base64").toString("utf8");
  // Then decrypt the encrypted string
  const decrypted = nusukDecrypt(encryptedStr);
  // Should match format: <secret>-<timestamp>
  assert.ok(/^\d{2}[&*@$]{2}[a-zA-Z]{2}-\d+$/.test(decrypted));
});

test("buildOtpTimeStamp generates unique values", () => {
  const otp1 = buildOtpTimeStamp();
  const otp2 = buildOtpTimeStamp();
  assert.notEqual(otp1, otp2);
});

test("buildLoginRequest returns payload and headers", () => {
  const { payload, headers } = buildLoginRequest({
    username: "user@test.com",
    password: "pass123",
    captchaToken: "captcha-token-123",
  });
  assert.ok(payload.captchaResponse, "captcha-token-123");
  assert.equal(payload.captchaResponse, "captcha-token-123");
  assert.ok(payload.otpTimeStamp);
  assert.equal(headers["X-Lang"], "en");
  assert.ok(headers["X-Channel"]);
  assert.ok(headers.authorization);
  assert.ok(!headers.trusteddevicetoken, "trusteddevicetoken should not be set when not provided");
});

test("buildLoginRequest includes trustedDeviceToken when provided", () => {
  const { headers } = buildLoginRequest({
    username: "user@test.com",
    password: "pass123",
    captchaToken: "token",
    trustedDeviceToken: "tdt_test123",
  });
  assert.equal(headers.trusteddevicetoken, "tdt_test123");
});

test("buildLoginRequest uses custom xChannel when provided", () => {
  const { headers } = buildLoginRequest({
    username: "user@test.com",
    password: "pass123",
    captchaToken: "token",
    xChannel: "custom-channel-value",
  });
  assert.equal(headers["X-Channel"], "custom-channel-value");
});

test("buildLoginRequest uses custom AES key when provided", () => {
  const customKey = "0123456789abcdef";
  const { headers } = buildLoginRequest({
    username: "user@test.com",
    password: "pass123",
    captchaToken: "token",
    key: customKey,
  });
  // Decrypt with the custom key to verify
  const decoded = decodeURIComponent(headers.authorization);
  const decrypted = nusukDecrypt(decoded, customKey);
  const expected = `Basic ${Buffer.from("user@test.com:pass123").toString("base64")}`;
  assert.equal(decrypted, expected);
});
