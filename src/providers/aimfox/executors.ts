import type { CredentialValidationResult, CredentialValidators, ProviderExecutors } from "../../core/types.ts";
import type { ApiKeyProviderContext } from "../provider-runtime.ts";
import type { AimfoxActionName } from "./actions.ts";

import {
  compactObject,
  objectArray,
  optionalBoolean,
  optionalNumber,
  optionalRecord,
  optionalString,
  requiredRecord,
  requiredString,
} from "../../core/cast.ts";
import { queryParams } from "../../core/request.ts";
import { defineApiKeyProviderExecutors, providerUserAgent, ProviderRequestError } from "../provider-runtime.ts";

const service = "aimfox";
const apiBaseUrl = "https://api.aimfox.com/api/v2";
const campaignValidationPath = "/campaigns";

const leadSearchBodyKeys = [
  "keywords",
  "current_companies",
  "past_companies",
  "education",
  "interests",
  "labels",
  "languages",
  "locations",
  "origins",
  "skills",
  "lead_of",
  "optimize",
] as const;

type AimfoxActionHandler = (input: Record<string, unknown>, context: ApiKeyProviderContext) => Promise<unknown>;

export const aimfoxActionHandlers: Record<AimfoxActionName, AimfoxActionHandler> = {
  async list_campaigns(input, context) {
    const payload = await requestAimfoxJson({
      context,
      path: "/campaigns",
      phase: "execute",
      query: compactObject({
        outreach_type: optionalString(input.outreach_type),
        accepts_profiles: optionalBoolean(input.accepts_profiles),
      }),
    });

    return {
      status: readNullableStatus(payload),
      campaigns: readObjectArray(payload.campaigns, "campaigns"),
    };
  },

  async get_campaign(input, context) {
    const campaignId = requiredProviderString(input.campaign_id, "campaign_id");
    const payload = await requestAimfoxJson({
      context,
      path: `/campaigns/${encodeURIComponent(campaignId)}`,
      phase: "execute",
      query: {},
    });

    return {
      status: readNullableStatus(payload),
      campaign: readRequiredObject(payload.campaign, "campaign"),
    };
  },

  async get_campaign_metrics(input, context) {
    const campaignId = requiredProviderString(input.campaign_id, "campaign_id");
    const payload = await requestAimfoxJson({
      context,
      path: `/campaigns/${encodeURIComponent(campaignId)}/metrics`,
      phase: "execute",
      query: {},
    });

    return {
      status: readNullableStatus(payload),
      metrics: readRequiredObject(payload.metrics, "metrics"),
    };
  },

  async add_profile_to_campaign(input, context) {
    const campaignId = requiredProviderString(input.campaign_id, "campaign_id");
    const payload = await requestAimfoxJson({
      context,
      path: `/campaigns/${encodeURIComponent(campaignId)}/audience`,
      method: "POST",
      body: {
        profile_url: requiredProviderString(input.profile_url, "profile_url"),
      },
      phase: "execute",
      query: {},
    });

    return { status: readNullableStatus(payload) };
  },

  async remove_profile_from_campaign(input, context) {
    const campaignId = requiredProviderString(input.campaign_id, "campaign_id");
    const urn = requiredProviderString(input.urn, "urn");
    const payload = await requestAimfoxJson({
      context,
      path: `/campaigns/${encodeURIComponent(campaignId)}/audience/${encodeURIComponent(urn)}`,
      method: "DELETE",
      phase: "execute",
      query: {},
    });

    return { status: readNullableStatus(payload) };
  },

  async get_lead(input, context) {
    const leadId = requiredProviderString(input.lead_id, "lead_id");
    const payload = await requestAimfoxJson({
      context,
      path: `/leads/${encodeURIComponent(leadId)}`,
      phase: "execute",
      query: {},
    });

    return {
      status: readNullableStatus(payload),
      lead: readRequiredObject(payload.lead, "lead"),
    };
  },

  async search_leads(input, context) {
    const payload = await requestAimfoxJson({
      context,
      path: "/leads:search",
      method: "POST",
      body: pickLeadSearchBody(input),
      phase: "execute",
      query: compactObject({
        start: optionalNumber(input.start),
        count: optionalNumber(input.count),
      }),
    });

    return {
      status: readNullableStatus(payload),
      leads: readObjectArray(payload.leads, "leads"),
    };
  },

  async get_total_leads_count(input, context) {
    const payload = await requestAimfoxJson({
      context,
      path: "/leads:search/total",
      method: "POST",
      body: pickLeadSearchBody(input),
      phase: "execute",
      query: {},
    });

    return {
      status: readNullableStatus(payload),
      total_leads: readRequiredNumber(payload.total_leads, "total_leads"),
      sync: readRequiredBoolean(payload.sync, "sync"),
      accounts_sync: optionalRecord(payload.accounts_sync) ?? {},
    };
  },

  async list_recent_leads(_input, context) {
    const payload = await requestAimfoxJson({
      context,
      path: "/analytics/recent-leads",
      phase: "execute",
      query: {},
    });

    return {
      status: readNullableStatus(payload),
      leads: readObjectArray(payload.leads, "leads"),
    };
  },

  async list_interactions(input, context) {
    const from = requiredProviderNumber(input.from, "from");
    const to = requiredProviderNumber(input.to, "to");
    if (from > to) {
      throw new ProviderRequestError(400, "from must be earlier than or equal to to");
    }

    const payload = await requestAimfoxJson({
      context,
      path: "/analytics/interactions",
      phase: "execute",
      query: compactObject({
        bucket: requiredProviderString(input.bucket, "bucket"),
        from,
        to,
        account_ids: optionalJsonArray(input.account_ids),
        campaign_id: optionalString(input.campaign_id),
      }),
    });

    return {
      status: readNullableStatus(payload),
      count: readRequiredNumber(payload.count, "count"),
      buckets: readObjectArray(payload.buckets, "buckets"),
    };
  },

  async list_workspace_labels(_input, context) {
    const payload = await requestAimfoxJson({
      context,
      path: "/labels",
      phase: "execute",
      query: {},
    });

    return {
      status: readNullableStatus(payload),
      labels: readObjectArray(payload.labels, "labels"),
    };
  },
};

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, aimfoxActionHandlers);

export const credentialValidators: CredentialValidators = {
  async apiKey(input, { fetcher, signal }): Promise<CredentialValidationResult> {
    await requestAimfoxJson({
      context: { apiKey: input.apiKey, fetcher, signal },
      path: campaignValidationPath,
      phase: "validate",
      query: {},
    });

    return {
      profile: {
        accountId: "api_key",
        displayName: "Aimfox API Key",
      },
      grantedScopes: [],
      metadata: {
        apiBaseUrl,
        validationEndpoint: campaignValidationPath,
      },
    };
  },
};

async function requestAimfoxJson(input: {
  context: Pick<ApiKeyProviderContext, "apiKey" | "fetcher" | "signal">;
  path: string;
  phase: "validate" | "execute";
  query: Record<string, string | number | boolean | undefined>;
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const url = new URL(`${apiBaseUrl}${input.path}`);
  for (const [key, value] of Object.entries(queryParams(input.query))) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  let payload: unknown;
  try {
    response = await input.context.fetcher(url, {
      method: input.method ?? "GET",
      headers: buildHeaders(input.context.apiKey, input.body !== undefined),
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: input.context.signal,
    });
    payload = await readPayload(response);
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw error;
    }

    throw new ProviderRequestError(
      502,
      error instanceof Error ? `Aimfox API request failed: ${error.message}` : "Aimfox API request failed",
    );
  }

  if (!response.ok) {
    throw createAimfoxError(response, payload, input.phase);
  }

  return readRequiredObject(payload, "Aimfox response");
}

function buildHeaders(apiKey: string, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
    "user-agent": providerUserAgent,
  };
  if (hasBody) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderRequestError(502, "Aimfox API returned a non-JSON response");
  }
}

function createAimfoxError(response: Response, payload: unknown, phase: "validate" | "execute"): ProviderRequestError {
  const record = optionalRecord(payload);
  const error = optionalRecord(record?.error);
  const message =
    optionalString(error?.message) ??
    optionalString(record?.message) ??
    `Aimfox API request failed with status ${response.status}`;
  if (phase === "validate" && (response.status === 401 || response.status === 403)) {
    return new ProviderRequestError(400, message, payload);
  }
  return new ProviderRequestError(response.status >= 500 ? 502 : response.status, message, payload);
}

function pickLeadSearchBody(input: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of leadSearchBodyKeys) {
    const value = input[key];
    if (value !== undefined) {
      body[key] = value;
    }
  }
  return body;
}

function optionalJsonArray(value: unknown): string | undefined {
  return Array.isArray(value) ? JSON.stringify(value) : undefined;
}

function readNullableStatus(payload: Record<string, unknown>): string | null {
  return optionalString(payload.status) ?? null;
}

function requiredProviderString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}

function requiredProviderNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new ProviderRequestError(400, `${fieldName} is required`);
}

function readRequiredNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new ProviderRequestError(502, `Aimfox response missing ${fieldName}`);
}

function readRequiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new ProviderRequestError(502, `Aimfox response missing ${fieldName}`);
}

function readRequiredObject(value: unknown, fieldName: string): Record<string, unknown> {
  return requiredRecord(value, fieldName, (message) => new ProviderRequestError(502, message));
}

function readObjectArray(value: unknown, fieldName: string): Array<Record<string, unknown>> {
  return objectArray(value, fieldName, (message) => new ProviderRequestError(502, message));
}
