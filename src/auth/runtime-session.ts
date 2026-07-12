import type { Principal } from "./principal.ts";

export interface RuntimeSession {
  sessionId: string;
  principal: Principal;
  issuedAt: number;
  expiresAt: number;
  executionId: string;
}

export function createRuntimeSession(principal: Principal): RuntimeSession {
  return {
    sessionId: crypto.randomUUID(),
    principal,
    issuedAt: principal.issuedAt,
    expiresAt: principal.expiresAt,
    executionId: crypto.randomUUID(),
  };
}
