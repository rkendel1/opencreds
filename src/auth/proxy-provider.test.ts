import { describe, expect, it } from "vitest";
import { ProxyAuthProvider } from "./proxy-provider.ts";

describe("ProxyAuthProvider", () => {
  it("rejects identity headers when trusted proxy mode is disabled", async () => {
    const provider = new ProxyAuthProvider({ trustedProxy: false });
    await expect(
      provider.authenticate({
        path: "/v1/actions/test",
        method: "POST",
        header: (name) => (name === "x-user-id" ? "user-a" : undefined),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("accepts trusted proxy headers and produces a principal", async () => {
    const provider = new ProxyAuthProvider({ trustedProxy: true });
    const principal = await provider.authenticate({
      path: "/v1/actions/test",
      method: "POST",
      header: (name) =>
        name === "x-oc-principal-id"
          ? "svc-1"
          : name === "x-oc-principal-type"
            ? "service"
            : name === "x-tenant-id"
              ? "tenant-1"
              : name === "x-user-id"
                ? "user-1"
                : undefined,
    });
    expect(principal).toMatchObject({
      id: "svc-1",
      type: "service",
      tenantId: "tenant-1",
      userId: "user-1",
    });
  });
});
