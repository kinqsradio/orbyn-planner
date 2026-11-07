import { describe, expect, it, vi } from "vitest";
import { ApiFailure, createAuthApi, plainMessage } from "./auth";

function api(respond: (url: string, init: RequestInit) => Response | Promise<Response>, token: string | null = "tok") {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => respond(url, init));
  const onUnauthorized = vi.fn();
  return { client: createAuthApi({ baseUrl: "http://engine.test", fetch: fetchMock as unknown as typeof fetch, token: () => token, onUnauthorized }), fetchMock, onUnauthorized };
}
const error = (status: number, code: string, message = "m") => new Response(JSON.stringify({ code, message }), { status });

describe("the account calls", () => {
  it("send JSON to the right routes, with the Bearer token on signed-in ones only", async () => {
    const { client, fetchMock } = api(() => new Response(JSON.stringify({ registration_response: "x" })));
    await client.registerStart({ email: "a@b.co", registration_request: "r" });
    await client.devices().catch(() => undefined);
    const [start, list] = fetchMock.mock.calls;
    expect(start![0]).toBe("http://engine.test/v1/accounts/register/start");
    expect(start![1]).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect((start![1].headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(start![1].body as string)).toEqual({ email: "a@b.co", registration_request: "r" });
    expect(list![0]).toBe("http://engine.test/v1/devices");
    expect(list![1]).toMatchObject({ method: "GET", headers: { authorization: "Bearer tok" } });
  });

  it("a 401 ends the session on every call, except that the three two-factor calls keep it for a wrong code or a refused signature", async () => {
    const answers = ["second_factor_failed", "device_proof_required"] as const;
    for (const code of answers) {
      const { client, onUnauthorized } = api(() => error(401, code));
      await client.totpEnrol({ device_signature: null, signed_at: null }).catch(() => undefined);
      await client.totpConfirm({ code: "1", device_signature: null, signed_at: null }).catch(() => undefined);
      await client.totpDisable({ device_signature: null, signed_at: null }).catch(() => undefined);
      expect(onUnauthorized).not.toHaveBeenCalled();
      // Any other signed-in call answered the same way means the session is over.
      await client.devices().catch(() => undefined);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    }
    // And the two-factor calls still end it for a real 401.
    const { client, onUnauthorized } = api(() => error(401, "unauthorized"));
    await client.totpDisable({ device_signature: null, signed_at: null }).catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("uses the routes of the engine for every call", async () => {
    const { client, fetchMock } = api(() => new Response(JSON.stringify({}), { status: 200 }));
    await client.registerFinish({} as never);
    await client.loginStart({ email: "a@b.co", credential_request: "r" });
    await client.loginFinish({} as never);
    await client.signOut().catch(() => undefined);
    await client.signOutEverywhere().catch(() => undefined);
    await client.currentDevice();
    await client.createApproval({ approval_id: "x", device_id: "d", created_at: 1, commitment: "c" });
    await client.approval("a b");
    await client.submitNonce("a b", { nonce: "n" });
    await client.revealNonce("a b", { nonce: "n" });
    await client.confirmApproval("a b", { signature: "s" });
    await client.cancelApproval("a b");
    await client.submitCode("a b", { code: "123456" });
    await client.removeDevice("d/1", { sequence: 1, signature: "s" });
    expect(fetchMock.mock.calls.map(([u, i]) => `${i.method} ${String(u).replace("http://engine.test", "")}`)).toEqual([
      "POST /v1/accounts/register/finish",
      "POST /v1/sessions/login/start",
      "POST /v1/sessions/login/finish",
      "DELETE /v1/sessions/current",
      "DELETE /v1/sessions",
      "GET /v1/devices/current",
      "POST /v1/devices/approvals",
      "GET /v1/devices/approvals/a%20b",
      "POST /v1/devices/approvals/a%20b/nonce",
      "POST /v1/devices/approvals/a%20b/reveal",
      "POST /v1/devices/approvals/a%20b/confirm",
      "POST /v1/devices/approvals/a%20b/cancel",
      "POST /v1/devices/approvals/a%20b/code",
      "DELETE /v1/devices/d%2F1",
    ]);
  });

  it("sends the trusted-device proof, with its time as a plain number", async () => {
    const { client, fetchMock } = api(() => new Response(JSON.stringify({ login_id: "l", credential_response: "c" })));
    await client.loginStart({ email: "a@b.co", credential_request: "r", trusted_device: { signing_key: "k", signed_at: 1_794_000_000n, signature: "s" } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).trusted_device).toEqual({ signing_key: "k", signed_at: 1_794_000_000, signature: "s" });
  });

  it("a 204 answer is nothing", async () => {
    const { client } = api(() => new Response(null, { status: 204 }));
    await expect(client.removeDevice("d", { sequence: 1, signature: "s" })).resolves.toBeUndefined();
  });
});

describe("errors", () => {
  const cases: [string, number, RegExp][] = [
    ["too_many_attempts", 429, /Too many attempts/],
    ["email_unavailable", 409, /can’t be used for a new account/],
    ["login_failed", 401, /email and password don’t match/],
    ["device_not_trusted", 403, /hasn’t been approved/],
    ["last_trusted_device", 409, /last trusted device/],
    ["approval_expired", 410, /ran out of time/],
    ["invalid_email", 400, /valid email/],
    ["accounts_unavailable", 503, /isn’t set up on this server/],
    ["internal", 500, /Something went wrong on the server/],
  ];
  it.each(cases)("%s becomes a plain message", async (code, status, text) => {
    const { client } = api(() => error(status, code, "raw server text"));
    const failure = await client.loginStart({ email: "a@b.co", credential_request: "r" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({ code, status });
    expect((failure as ApiFailure).message).toMatch(text);
    expect((failure as ApiFailure).message).not.toContain("raw server text");
  });

  it("a wrong code closes the approval, and says to start again", async () => {
    const { client } = api(() => error(400, "wrong_code", "The code is wrong. Attempts left: 0."));
    const failure = (await client.submitCode("a", { code: "000000" }).catch((e: unknown) => e)) as ApiFailure;
    expect(failure.code).toBe("wrong_code");
    expect(failure.message).toMatch(/Start again/);
  });

  it("an unreachable server is a network error", async () => {
    const { client } = api(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(client.registerStart({ email: "a@b.co", registration_request: "r" })).rejects.toMatchObject({ code: "network", message: expect.stringContaining("Can’t reach the server") });
  });

  it("an answer that is not the engine's still gives a plain message", async () => {
    const { client } = api(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(client.devices()).rejects.toMatchObject({ code: "internal", status: 502 });
    expect(plainMessage("surprise")).toBe("Something went wrong. Try again.");
  });

  it("a 401 on a signed-in call tells the app the session is over; on sign-in it does not", async () => {
    const { client, onUnauthorized } = api(() => error(401, "unauthorized"));
    await expect(client.devices()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(client.loginFinish({} as never)).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
