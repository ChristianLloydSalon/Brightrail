// @vitest-environment node
// Regression test: stored secrets are bound to their row (November 2026 security audit).
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ env: { encryptionKey: randomBytes(32).toString("base64") } }));
const { connectionSecretContext, decryptSecret, encryptSecret } = await import("./crypto");

describe("secret encryption", () => {
  it("binds a ciphertext to its record", () => {
    const sealed = encryptSecret("token-123", connectionSecretContext("conn-a"));
    expect(sealed.startsWith("v2.")).toBe(true);
    expect(decryptSecret(sealed, connectionSecretContext("conn-a"))).toBe("token-123");
    expect(() => decryptSecret(sealed, connectionSecretContext("conn-b"))).toThrow();
    expect(() => decryptSecret(sealed)).toThrow();
  });
  it("still reads legacy v1 secrets", () => {
    const legacy = encryptSecret("old");
    expect(legacy.startsWith("v1.")).toBe(true);
    expect(decryptSecret(legacy, connectionSecretContext("any"))).toBe("old");
  });
});
