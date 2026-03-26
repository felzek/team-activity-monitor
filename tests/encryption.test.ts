import { describe, expect, it } from "vitest";

import { decrypt, encrypt, maskApiKey } from "../src/lib/encryption.js";

describe("encryption utilities", () => {
  const secret = "test-secret-for-encryption-unit-tests";

  it("encrypts and decrypts a plaintext string", () => {
    const plaintext = "sk-test-1234567890abcdef";
    const ciphertext = encrypt(plaintext, secret);

    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.length).toBeGreaterThan(0);

    const decrypted = decrypt(ciphertext, secret);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same input (random salt/IV)", () => {
    const plaintext = "sk-test-1234567890abcdef";
    const a = encrypt(plaintext, secret);
    const b = encrypt(plaintext, secret);

    expect(a).not.toBe(b);
    expect(decrypt(a, secret)).toBe(plaintext);
    expect(decrypt(b, secret)).toBe(plaintext);
  });

  it("fails to decrypt with a wrong secret", () => {
    const ciphertext = encrypt("my-api-key", secret);
    expect(() => decrypt(ciphertext, "wrong-secret")).toThrow();
  });

  it("handles empty strings", () => {
    const ciphertext = encrypt("", secret);
    expect(decrypt(ciphertext, secret)).toBe("");
  });

  it("handles long API keys", () => {
    const longKey = "sk-" + "a".repeat(500);
    const ciphertext = encrypt(longKey, secret);
    expect(decrypt(ciphertext, secret)).toBe(longKey);
  });

  it("masks API keys correctly", () => {
    expect(maskApiKey("sk-test-1234567890abcdef")).toBe("sk-t••••cdef");
    expect(maskApiKey("short")).toBe("••••••••");
    expect(maskApiKey("12345678")).toBe("••••••••");
    expect(maskApiKey("123456789")).toBe("1234••••6789");
    expect(maskApiKey("abcdefghij")).toBe("abcd••••ghij");
  });
});
