/**
 * Ad Group tools: list, create, update (status, CPC bid).
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch, mutate } from "./api.js";
import { buildPage, errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

const AD_GROUP_STATUSES = ["ENABLED", "PAUSED", "REMOVED"] as const;
const AD_GROUP_TYPES = ["SEARCH_STANDARD", "DISPLAY_STANDARD"] as const;

export function registerAdGroupTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_ad_groups",
    {
      title: "List Ad Groups",
      description: "Elenca i gruppi di annunci di una campagna (o di tutto l'account), con stato e CPC bid.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        campaign_id: z.string().optional().describe("Se impostato, filtra solo i gruppi di annunci di questa campagna (solo l'ID numerico, senza 'campaigns/')."),
        status_filter: z.enum(AD_GROUP_STATUSES).optional().describe("Se impostato, filtra per stato. Default: tutti tranne REMOVED."),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Numero massimo di risultati.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, campaign_id, status_filter, limit }, ctx): Promise<McpToolResult> => {
      try {
        const conditions = [status_filter ? `ad_group.status = '${status_filter}'` : `ad_group.status != 'REMOVED'`];
        if (campaign_id) conditions.push(`campaign.id = ${campaign_id.replace(/[^0-9]/g, "")}`);
        const query =
          "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros, " +
          "ad_group.primary_status, ad_group.primary_status_reasons, campaign.id, campaign.name " +
          `FROM ad_group WHERE ${conditions.join(" AND ")} ORDER BY ad_group.id`;
        const result = await gaqlSearch(customer_id, query, limit, undefined, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, { customer_id, has_more: Boolean(result.nextPageToken) });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_ad_group",
    {
      title: "Create Ad Group",
      description: "Crea un nuovo gruppo di annunci dentro una campagna esistente.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        campaign_resource_name: z.string().min(1).describe("Resource name della campagna, es. 'customers/1234567890/campaigns/111222333'."),
        name: z.string().min(1).describe("Nome del gruppo di annunci."),
        type: z.enum(AD_GROUP_TYPES).default("SEARCH_STANDARD").describe("Tipo di gruppo di annunci (deve corrispondere al tipo di campagna)."),
        cpc_bid_micros: z.number().int().positive().optional().describe("CPC bid manuale in micros (solo rilevante se la campagna usa MANUAL_CPC)."),
        status: z.enum(AD_GROUP_STATUSES).default("ENABLED").describe("Stato iniziale.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, campaign_resource_name, name, type, cpc_bid_micros, status }, ctx): Promise<McpToolResult> => {
      try {
        const adGroup: Record<string, unknown> = { name, campaign: campaign_resource_name, type, status };
        if (cpc_bid_micros !== undefined) adGroup.cpcBidMicros = cpc_bid_micros;
        const result = await mutate(customer_id, "adGroups", [{ create: adGroup }], false, ctx.mcpReq.signal);
        return jsonResult({ created: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_update_ad_group",
    {
      title: "Update Ad Group",
      description: "Aggiorna un gruppo di annunci esistente: stato e/o CPC bid.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        ad_group_resource_name: z.string().min(1).describe("Resource name del gruppo di annunci, es. 'customers/1234567890/adGroups/555666'."),
        status: z.enum(AD_GROUP_STATUSES).optional().describe("Nuovo stato."),
        cpc_bid_micros: z.number().int().positive().optional().describe("Nuovo CPC bid manuale in micros."),
        name: z.string().min(1).optional().describe("Nuovo nome.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, ad_group_resource_name, status, cpc_bid_micros, name }, ctx): Promise<McpToolResult> => {
      try {
        const update: Record<string, unknown> = { resourceName: ad_group_resource_name };
        const maskFields: string[] = [];
        if (status !== undefined) {
          update.status = status;
          maskFields.push("status");
        }
        if (cpc_bid_micros !== undefined) {
          update.cpcBidMicros = cpc_bid_micros;
          maskFields.push("cpc_bid_micros");
        }
        if (name !== undefined) {
          update.name = name;
          maskFields.push("name");
        }
        if (maskFields.length === 0) {
          return errorResult("Nessun campo da aggiornare: specifica status, cpc_bid_micros e/o name.");
        }
        const result = await mutate(
          customer_id,
          "adGroups",
          [{ update, updateMask: maskFields.join(",") }],
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
