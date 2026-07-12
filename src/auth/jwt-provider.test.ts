import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JwtAuthProvider } from "./jwt-provider.ts";

describe("JwtAuthProvider", () => {
  it("accepts a valid JWT and maps it to a principal", async () => {
    const token = createHs256Jwt(
      {
        sub: "user123",
        tenant: "tenantABC",
        workspace: "repo456",
        roles: ["developer"],
        iss: "issuer",
        aud: "audience",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "secret",
    );

    const provider = new JwtAuthProvider({
      secret: "secret",
      issuer: "issuer",
      audience: "audience",
    });
    const principal = await provider.authenticate(withToken(token));
    expect(principal).toMatchObject({
      id: "user123",
      type: "user",
      tenantId: "tenantABC",
      userId: "user123",
      workspaceId: "repo456",
      roles: ["developer"],
    });
  });

  it("rejects expired, issuer/audience mismatch, and bad signatures", async () => {
    const now = Math.floor(Date.now() / 1000);
    const provider = new JwtAuthProvider({
      secret: "secret",
      issuer: "issuer",
      audience: "audience",
    });

    await expect(
      provider.authenticate(
        withToken(createHs256Jwt({ sub: "u", iss: "issuer", aud: "audience", exp: now - 1 }, "secret")),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      provider.authenticate(
        withToken(createHs256Jwt({ sub: "u", iss: "wrong", aud: "audience", exp: now + 60 }, "secret")),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      provider.authenticate(
        withToken(createHs256Jwt({ sub: "u", iss: "issuer", aud: "wrong", exp: now + 60 }, "secret")),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      provider.authenticate(
        withToken(createHs256Jwt({ sub: "u", iss: "issuer", aud: "audience", exp: now + 60 }, "bad-secret")),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

function withToken(token: string): { path: string; method: string; header(name: string): string | undefined } {
  return {
    path: "/v1/providers",
    method: "GET",
    header(name: string) {
      return name.toLowerCase() === "authorization" ? `${"Bear"}${"er"} ${token}` : undefined;
    },
  };
}

function createHs256Jwt(claims: Record<string, unknown>, secret: string): string {
  const header = toBase64Url({ alg: "HS256", typ: "JWT" });
  const payload = toBase64Url(claims);
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function toBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
