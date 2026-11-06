import { describe, expect, it } from "vitest";
import { concat, utf8 } from "./bytes";
import {
  DEVICE_LOGIN_CONTEXT,
  DEVICE_REGISTER_CONTEXT,
  TRUSTED_START_CONTEXT,
  loginMessage,
  normalizeEmail,
  registerMessage,
  trustedStartMessage,
} from "./testing/authMessages";

// The mock engine and the fake crypto build these (the real ones come from the WebAssembly
// module); they are written to match orbyn-auth-client, and these tests pin the layout.

const a = { signing: new Uint8Array(32).fill(1), agreement: new Uint8Array(32).fill(2) };
const b = { signing: new Uint8Array(32).fill(1), agreement: new Uint8Array(32).fill(3) };
const uuidA = "00000000-0000-4000-8000-000000000001";
const uuidB = "00000000-0000-4000-8000-000000000002";

describe("device messages (as orbyn-auth-client builds them)", () => {
  it("the contexts are the engine's", () => {
    expect([DEVICE_REGISTER_CONTEXT, DEVICE_LOGIN_CONTEXT, TRUSTED_START_CONTEXT]).toEqual([
      "orbyn/device-register/v1",
      "orbyn/device-login/v1",
      "orbyn/trusted-login-start/v1",
    ]);
  });

  it("register: length-prefixed email and upload, then both public keys", () => {
    const message = registerMessage("ab", new Uint8Array([99]), a);
    const be = (n: number) => new Uint8Array([0, 0, 0, 0, 0, 0, 0, n]);
    expect(message).toEqual(concat(be(2), utf8("ab"), be(1), new Uint8Array([99]), a.signing, a.agreement));
  });

  it("login: the raw id then keys", () => {
    expect(loginMessage(uuidA, a)).toHaveLength(16 + 64);
    expect(Array.from(loginMessage(uuidA, a).slice(0, 16))).toEqual([0, 0, 0, 0, 0, 0, 0x40, 0, 0x80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("trusted start ends with the time as eight bytes, big endian", () => {
    const message = trustedStartMessage("a@b.co", new Uint8Array([1, 2]), 258);
    expect(Array.from(message.slice(-8))).toEqual([0, 0, 0, 0, 0, 0, 1, 2]);
  });

  it("every part is bound: changing any one changes the message", () => {
    expect(loginMessage(uuidA, a)).not.toEqual(loginMessage(uuidA, b));
    expect(loginMessage(uuidA, a)).not.toEqual(loginMessage(uuidB, a));
    expect(registerMessage("ab", utf8("c"), a)).not.toEqual(registerMessage("a", utf8("bc"), a));
    expect(trustedStartMessage("a@b.co", new Uint8Array([1]), 1)).not.toEqual(trustedStartMessage("a@b.co", new Uint8Array([1]), 2));
  });

  it("emails are trimmed and lowercased, and checked the way the engine checks them", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    for (const bad of ["", "ada", "@example.com", "ada@", "a b@example.com", "a@b@c", "ada@.com", "ada@example.", "x".repeat(65) + "@example.com"]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });
});
