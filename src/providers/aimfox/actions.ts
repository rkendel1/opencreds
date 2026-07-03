import type { ProviderActionDefinition } from "../../core/provider-definition.ts";
import type { JsonSchema } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "aimfox";

const statusSchema = s.nullableString("The status returned by Aimfox.");
const rawObjectSchema = s.looseObject("A raw object returned by Aimfox.");
const rawObjectArraySchema = s.array("Raw objects returned by Aimfox.", rawObjectSchema);
const filterValuesSchema = s.array(
  "Filter values for an Aimfox lead search facet.",
  s.nonEmptyString("A filter value."),
);

const leadSearchBodyFields: Record<string, JsonSchema> = {
  keywords: s.string("Keywords to search for in Aimfox leads."),
  current_companies: filterValuesSchema,
  past_companies: filterValuesSchema,
  education: filterValuesSchema,
  interests: filterValuesSchema,
  labels: filterValuesSchema,
  languages: filterValuesSchema,
  locations: filterValuesSchema,
  origins: filterValuesSchema,
  skills: filterValuesSchema,
  lead_of: filterValuesSchema,
  optimize: s.boolean("Whether Aimfox should optimize the lead search."),
};

const leadSearchBodyOptionalFields = [
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

const leadSearchInputSchema = s.object(
  "Input for searching Aimfox leads.",
  {
    ...leadSearchBodyFields,
    start: s.nonNegativeInteger("The zero-based offset for the lead search results."),
    count: s.positiveInteger("The number of lead search results to return."),
  },
  {
    optional: [...leadSearchBodyOptionalFields, "start", "count"],
  },
);

const leadCountInputSchema = s.object("Input for counting Aimfox leads.", leadSearchBodyFields, {
  optional: leadSearchBodyOptionalFields,
});

const campaignIdInputSchema = s.actionInput(
  {
    campaign_id: s.nonEmptyString("The Aimfox campaign ID."),
  },
  ["campaign_id"],
  "Input for referencing one Aimfox campaign.",
);

export type AimfoxActionName =
  | "list_campaigns"
  | "get_campaign"
  | "get_campaign_metrics"
  | "add_profile_to_campaign"
  | "remove_profile_from_campaign"
  | "get_lead"
  | "search_leads"
  | "get_total_leads_count"
  | "list_recent_leads"
  | "list_interactions"
  | "list_workspace_labels";

export const aimfoxActions: Array<ProviderActionDefinition<AimfoxActionName>> = [
  defineProviderAction(service, {
    name: "list_campaigns",
    description: "List Aimfox campaigns, optionally filtering by outreach type or profile inserts.",
    inputSchema: s.actionInput(
      {
        outreach_type: s.stringEnum("The outreach type to filter campaigns by.", ["inbound", "outbound"]),
        accepts_profiles: s.boolean("Whether to return only campaigns that accept profile inserts."),
      },
      [],
      "Input for listing Aimfox campaigns.",
    ),
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        campaigns: rawObjectArraySchema,
      },
      "The campaigns returned by Aimfox.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_campaign",
    description: "Fetch one Aimfox campaign by campaign ID.",
    inputSchema: campaignIdInputSchema,
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        campaign: rawObjectSchema,
      },
      "The campaign returned by Aimfox.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_campaign_metrics",
    description: "Fetch interaction metrics for one Aimfox campaign.",
    inputSchema: campaignIdInputSchema,
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        metrics: rawObjectSchema,
      },
      "The campaign metrics returned by Aimfox.",
    ),
  }),
  defineProviderAction(service, {
    name: "add_profile_to_campaign",
    description: "Add one LinkedIn profile URL to an Aimfox campaign audience.",
    inputSchema: s.actionInput(
      {
        campaign_id: s.nonEmptyString("The Aimfox campaign ID."),
        profile_url: s.url("The LinkedIn profile URL to add to the campaign audience."),
      },
      ["campaign_id", "profile_url"],
      "Input for adding a profile to an Aimfox campaign.",
    ),
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
      },
      "The status returned after adding a profile to an Aimfox campaign.",
    ),
  }),
  defineProviderAction(service, {
    name: "remove_profile_from_campaign",
    description: "Remove one LinkedIn profile from an Aimfox campaign audience by URN or public ID.",
    inputSchema: s.actionInput(
      {
        campaign_id: s.nonEmptyString("The Aimfox campaign ID."),
        urn: s.nonEmptyString("The LinkedIn profile URN or public identifier to remove."),
      },
      ["campaign_id", "urn"],
      "Input for removing a profile from an Aimfox campaign.",
    ),
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
      },
      "The status returned after removing a profile from an Aimfox campaign.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_lead",
    description: "Fetch one Aimfox lead by lead ID.",
    inputSchema: s.actionInput(
      {
        lead_id: s.nonEmptyString("The Aimfox lead ID."),
      },
      ["lead_id"],
      "Input for fetching an Aimfox lead.",
    ),
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        lead: rawObjectSchema,
      },
      "The lead returned by Aimfox.",
    ),
  }),
  defineProviderAction(service, {
    name: "search_leads",
    description: "Search Aimfox leads with documented facet filters and offset pagination.",
    inputSchema: leadSearchInputSchema,
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        leads: rawObjectArraySchema,
      },
      "The leads returned by Aimfox search.",
    ),
  }),
  defineProviderAction(service, {
    name: "get_total_leads_count",
    description: "Count Aimfox leads that match the documented lead search filters.",
    inputSchema: leadCountInputSchema,
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        total_leads: s.nonNegativeInteger("The number of matching Aimfox leads."),
        sync: s.boolean("Whether Aimfox reports the count as synchronized."),
        accounts_sync: rawObjectSchema,
      },
      "The total lead count returned by Aimfox.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_recent_leads",
    description: "List recent Aimfox lead transition events for the workspace.",
    inputSchema: s.actionInput({}, [], "Input for listing recent Aimfox leads."),
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        leads: rawObjectArraySchema,
      },
      "The recent lead events returned by Aimfox.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_interactions",
    description: "List Aimfox interaction buckets for a timestamp range.",
    inputSchema: s.actionInput(
      {
        bucket: s.stringEnum("The interval used to group interaction metrics.", ["1 hour", "1 day"]),
        from: s.nonNegativeInteger("The range start timestamp in milliseconds."),
        to: s.nonNegativeInteger("The range end timestamp in milliseconds."),
        account_ids: s.array(
          "Aimfox account IDs to filter interactions by.",
          s.nonEmptyString("An Aimfox account ID."),
        ),
        campaign_id: s.nonEmptyString("The Aimfox campaign ID to filter interactions by."),
      },
      ["bucket", "from", "to"],
      "Input for listing Aimfox interactions.",
    ),
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        count: s.nonNegativeInteger("The number of interaction buckets returned by Aimfox."),
        buckets: rawObjectArraySchema,
      },
      "The interaction buckets returned by Aimfox.",
    ),
  }),
  defineProviderAction(service, {
    name: "list_workspace_labels",
    description: "List labels configured in the Aimfox workspace.",
    inputSchema: s.actionInput({}, [], "Input for listing Aimfox workspace labels."),
    outputSchema: s.actionOutput(
      {
        status: statusSchema,
        labels: rawObjectArraySchema,
      },
      "The workspace labels returned by Aimfox.",
    ),
  }),
];
