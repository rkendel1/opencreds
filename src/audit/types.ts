/**
 * Audit event types for tracking security-relevant operations.
 *
 * These types define the contract for audit logging. The actual logger
 * implementation can vary by deployment (console, database, external service).
 */

import type { IdentityContext } from "../identity/types.ts";

/**
 * Audit event types tracked by the runtime.
 */
export type AuditEventType =
  | "connection.created"
  | "connection.used"
  | "connection.deleted"
  | "token.created"
  | "token.revoked"
  | "action.executed"
  | "oauth.started"
  | "oauth.completed";

/**
 * Severity level for audit events.
 */
export type AuditEventSeverity = "info" | "warning" | "error";

/**
 * Base audit event payload common to all event types.
 */
export interface AuditEventBase {
  /** Event type identifier. */
  type: AuditEventType;
  /** When the event occurred. */
  timestamp: string;
  /** Identity context of the actor, if known. */
  identity?: IdentityContext;
  /** Severity level for the event. */
  severity: AuditEventSeverity;
}

/**
 * Connection created event.
 */
export interface ConnectionCreatedEvent extends AuditEventBase {
  type: "connection.created";
  service: string;
  connectionName: string;
  authType: string;
}

/**
 * Connection used event (credential resolved for action execution).
 */
export interface ConnectionUsedEvent extends AuditEventBase {
  type: "connection.used";
  service: string;
  connectionName: string;
  actionId?: string;
}

/**
 * Connection deleted event.
 */
export interface ConnectionDeletedEvent extends AuditEventBase {
  type: "connection.deleted";
  service: string;
  connectionName: string;
}

/**
 * Runtime token created event.
 */
export interface TokenCreatedEvent extends AuditEventBase {
  type: "token.created";
  tokenId: string;
  tokenName: string;
}

/**
 * Runtime token revoked event.
 */
export interface TokenRevokedEvent extends AuditEventBase {
  type: "token.revoked";
  tokenId: string;
}

/**
 * Action executed event.
 */
export interface ActionExecutedEvent extends AuditEventBase {
  type: "action.executed";
  actionId: string;
  service: string;
  executionId: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
}

/**
 * OAuth flow started event.
 */
export interface OAuthStartedEvent extends AuditEventBase {
  type: "oauth.started";
  service: string;
  connectionName?: string;
}

/**
 * OAuth flow completed event.
 */
export interface OAuthCompletedEvent extends AuditEventBase {
  type: "oauth.completed";
  service: string;
  connectionName: string;
  success: boolean;
  errorCode?: string;
}

/**
 * Union of all audit event types.
 */
export type AuditEvent =
  | ConnectionCreatedEvent
  | ConnectionUsedEvent
  | ConnectionDeletedEvent
  | TokenCreatedEvent
  | TokenRevokedEvent
  | ActionExecutedEvent
  | OAuthStartedEvent
  | OAuthCompletedEvent;

/**
 * Audit logger interface for recording security events.
 *
 * Implementations may log to console, database, or external audit services.
 */
export interface IAuditLogger {
  /**
   * Record an audit event.
   *
   * Implementations should be async-safe and not block the calling code.
   */
  record(event: AuditEvent): void;
}

/**
 * No-op audit logger for single-user deployments.
 *
 * Events are silently discarded.
 */
export class NoopAuditLogger implements IAuditLogger {
  record(_event: AuditEvent): void {
    // No-op: events are discarded in single-user mode
  }
}

/**
 * Console audit logger for development and debugging.
 *
 * Events are logged to stdout as JSON.
 */
export class ConsoleAuditLogger implements IAuditLogger {
  record(event: AuditEvent): void {
    console.log("[audit]", JSON.stringify(event));
  }
}
