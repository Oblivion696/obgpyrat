/**
 * Shared bidding-strategy helpers, used both by campaign creation tools and
 * by the dedicated google_ads_update_campaign_bidding_strategy tool. Google
 * Ads represents a campaign's bidding strategy as one "oneof" sub-message
 * (manualCpc, maximizeConversions, maximizeConversionValue, targetCpa,
 * targetRoas, ...); setting a different one switches the strategy.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { mutate } from "./api.js";
import { errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";

export const BIDDING_STRATEGY_TYPES = [
  "MANUAL_CPC",
  "MAXIMIZE_CONVERSIONS",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_CPA",
  "TARGET_ROAS"
] as const;
export type BiddingStrategyType = (typeof BIDDING_STRATEGY_TYPES)[number];

export interface BiddingFieldResult {
  /** The field(s) to merge into the campaign create/update body. */
  field: Record<string, unknown>;
  /** The snake_case field name to list in updateMask. */
  maskField: string;
}

/**
 * Builds the campaign-level bidding sub-message for the given strategy.
 * target_roas is a fraction (e.g. 4.0 = 400% ROAS = 4 EUR revenue per 1 EUR
 * spent). target_cpa_micros is in micros (1,000,000 micros = 1 unit of
 * currency).
 */
export function buildBiddingField(
  type: BiddingStrategyType,
  targetRoas?: number,
  targetCpaMicros?: number
): BiddingFieldResult {
  switch (type) {
    case "MANUAL_CPC":
      return { field: { manualCpc: {} }, maskField: "manual_cpc" };
    case "MAXIMIZE_CONVERSIONS":
      return {
        field: { maximizeConversions: targetCpaMicros ? { targetCpaMicros } : {} },
        maskField: "maximize_conversions"
      };
    case "MAXIMIZE_CONVERSION_VALUE":
      return {
        field: { maximizeConversionValue: targetRoas ? { targetRoas } : {} },
        maskField: "maximize_conversion_value"
      };
    case "TARGET_CPA":
      if (!targetCpaMicros) {
        throw new Error("target_cpa_micros e' obbligatorio quando bidding_strategy_type = TARGET_CPA.");
      }
      return { field: { targetCpa: { targetCpaMicros } }, maskField: "target_cpa" };
    case "TARGET_ROAS":
      if (!targetRoas) {
        throw new Error("target_roas e' obbligatorio quando bidding_strategy_type = TARGET_ROAS (es. 4.0 = 400%).");
      }
      return { field: { targetRoas: { targetRoas } }, maskField: "target_roas" };
  }
}

export function registerBiddingTools(server: McpServer): void {
  server.registerTool(
    "google_ads_update_campaign_bidding_strategy",
    {
      title: "Update Campaign Bidding Strategy",
      description:
        "Cambia la strategia di offerta (bidding) di una campagna esistente: MANUAL_CPC, MAXIMIZE_CONVERSIONS, MAXIMIZE_CONVERSION_VALUE, TARGET_CPA o TARGET_ROAS. " +
        "Per TARGET_ROAS passa target_roas come frazione (es. 4.0 = ritorno del 400%, cioe' 4 EUR di ricavo per 1 EUR di spesa). " +
        "Per TARGET_CPA passa target_cpa_micros in micros (1.000.000 micros = 1 unita di valuta).",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        campaign_resource_name: z
          .string()
          .min(1)
          .describe("Resource name della campagna, es. 'customers/1234567890/campaigns/111222333'."),
        bidding_strategy_type: z.enum(BIDDING_STRATEGY_TYPES).describe("Nuova strategia di offerta."),
        target_roas: z
          .number()
          .positive()
          .optional()
          .describe("Obbligatorio se bidding_strategy_type=TARGET_ROAS; opzionale come target per MAXIMIZE_CONVERSION_VALUE."),
        target_cpa_micros: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Obbligatorio se bidding_strategy_type=TARGET_CPA; opzionale come target per MAXIMIZE_CONVERSIONS.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async (
      { customer_id, campaign_resource_name, bidding_strategy_type, target_roas, target_cpa_micros },
      ctx
    ): Promise<McpToolResult> => {
      try {
        const { field, maskField } = buildBiddingField(bidding_strategy_type, target_roas, target_cpa_micros);
        const result = await mutate(
          customer_id,
          "campaigns",
          [{ update: { resourceName: campaign_resource_name, ...field }, updateMask: maskField }],
          false,
          ctx.mcpReq.signal
        );
        return jsonResult({ updated: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
