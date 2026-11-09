/**
 * Ad tools: list ads in a group/campaign, create Responsive Search Ads (RSA).
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch, mutate } from "./api.js";
import { buildPage, errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

const AD_STATUSES = ["ENABLED", "PAUSED", "REMOVED"] as const;

export function registerAdTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_ads",
    {
      title: "List Ads",
      description: "Elenca gli annunci di un gruppo di annunci (o di tutto l'account), con headline/descrizioni per le Responsive Search Ad.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        ad_group_id: z.string().optional().describe("Se impostato, filtra solo gli annunci di questo gruppo (solo l'ID numerico)."),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Numero massimo di risultati.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, ad_group_id, limit }, ctx): Promise<McpToolResult> => {
      try {
        const conditions = ["ad_group_ad.status != 'REMOVED'"];
        if (ad_group_id) conditions.push(`ad_group.id = ${ad_group_id.replace(/[^0-9]/g, "")}`);
        const query =
          "SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, " +
          "ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, " +
          "ad_group_ad.policy_summary.approval_status, ad_group.id, ad_group.name, campaign.id, campaign.name " +
          `FROM ad_group_ad WHERE ${conditions.join(" AND ")} ORDER BY ad_group.id`;
        const result = await gaqlSearch(customer_id, query, limit, undefined, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, { customer_id, has_more: Boolean(result.nextPageToken) });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_responsive_search_ad",
    {
      title: "Create Responsive Search Ad",
      description:
        "Crea un annuncio Responsive Search Ad (RSA) dentro un gruppo di annunci esistente. " +
        "Servono almeno 3 headline (max 30 caratteri ciascuna, max 15 totali) e almeno 2 descrizioni (max 90 caratteri ciascuna, max 4 totali). " +
        "Google ruota automaticamente le combinazioni di headline/descrizioni per ottimizzare il rendimento.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        ad_group_resource_name: z.string().min(1).describe("Resource name del gruppo di annunci, es. 'customers/1234567890/adGroups/555666'."),
        headlines: z
          .array(z.string().min(1).max(30))
          .min(3)
          .max(15)
          .describe("Da 3 a 15 titoli, max 30 caratteri ciascuno."),
        descriptions: z
          .array(z.string().min(1).max(90))
          .min(2)
          .max(4)
          .describe("Da 2 a 4 descrizioni, max 90 caratteri ciascuna."),
        final_urls: z.array(z.string().url()).min(1).describe("URL finali (pagine di destinazione) dell'annuncio."),
        path1: z.string().max(15).optional().describe("Primo segmento del percorso visibile nell'URL (max 15 caratteri)."),
        path2: z.string().max(15).optional().describe("Secondo segmento del percorso visibile nell'URL (max 15 caratteri)."),
        status: z.enum(AD_STATUSES).default("ENABLED").describe("Stato iniziale dell'annuncio.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (
      { customer_id, ad_group_resource_name, headlines, descriptions, final_urls, path1, path2, status },
      ctx
    ): Promise<McpToolResult> => {
      try {
        const responsiveSearchAd: Record<string, unknown> = {
          headlines: headlines.map(text => ({ text })),
          descriptions: descriptions.map(text => ({ text }))
        };
        if (path1) responsiveSearchAd.path1 = path1;
        if (path2) responsiveSearchAd.path2 = path2;

        const adGroupAd: Record<string, unknown> = {
          adGroup: ad_group_resource_name,
          status,
          ad: { finalUrls: final_urls, responsiveSearchAd }
        };
        const result = await mutate(customer_id, "adGroupAds", [{ create: adGroupAd }], false, ctx.mcpReq.signal);
        return jsonResult({ created: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
