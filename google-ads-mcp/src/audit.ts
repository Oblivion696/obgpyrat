/**
 * Account audit tool: surfaces the newer primary_status / primary_status_reasons
 * fields at campaign and ad-group level in one call, so an agent can see WHY
 * something isn't serving (e.g. PAUSED, LOW_QUALITY, PAYMENT_ISSUE,
 * CAMPAIGN_PENDING) instead of just that it isn't delivering impressions.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch } from "./api.js";
import { errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";

export function registerAuditTools(server: McpServer): void {
  server.registerTool(
    "google_ads_audit_account_status",
    {
      title: "Audit Account Status",
      description:
        "Audit di sola lettura: controlla il primary_status e primary_status_reasons (i codici piu' recenti e piu' precisi di Google) di ogni campagna e ogni gruppo di annunci dell'account, " +
        "per capire SUBITO perche' qualcosa non sta servendo (es. LIMITED_BY_BUDGET, PENDING, PAYMENT_ISSUE, LOW_QUALITY, CAMPAIGN_PAUSED), non solo che non lo sta facendo. " +
        "Per default mostra solo le campagne/gruppi NON pienamente idonei (primary_status diverso da ELIGIBLE); imposta only_problems=false per vedere anche quelli sani.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        only_problems: z
          .boolean()
          .default(true)
          .describe("Se true (default), mostra solo campagne/gruppi con primary_status diverso da ELIGIBLE.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, only_problems }, ctx): Promise<McpToolResult> => {
      try {
        const campaignQuery =
          "SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons, campaign.advertising_channel_type " +
          "FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id";
        const adGroupQuery =
          "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.primary_status, ad_group.primary_status_reasons, campaign.id, campaign.name " +
          "FROM ad_group WHERE ad_group.status != 'REMOVED' ORDER BY ad_group.id";

        const [campaigns, adGroups] = await Promise.all([
          gaqlSearch(customer_id, campaignQuery, 200, undefined, ctx.mcpReq.signal),
          gaqlSearch(customer_id, adGroupQuery, 200, undefined, ctx.mcpReq.signal)
        ]);

        const filterFn = (row: Record<string, unknown>) => {
          if (!only_problems) return true;
          const obj = row as { campaign?: { primaryStatus?: string }; adGroup?: { primaryStatus?: string } };
          const status = obj.campaign?.primaryStatus ?? obj.adGroup?.primaryStatus;
          return status !== undefined && status !== "ELIGIBLE";
        };

        const campaignRows = campaigns.results.filter(filterFn);
        const adGroupRows = adGroups.results.filter(filterFn);

        return jsonResult({
          customer_id,
          only_problems,
          campaigns_count: campaignRows.length,
          campaigns: campaignRows,
          ad_groups_count: adGroupRows.length,
          ad_groups: adGroupRows,
          nota:
            campaignRows.length === 0 && adGroupRows.length === 0 && only_problems
              ? "Nessun problema di eleggibilita' rilevato: tutte le campagne/gruppi controllati hanno primary_status = ELIGIBLE."
              : undefined
        });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
