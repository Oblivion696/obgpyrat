/**
 * Keyword tools: list, add positive keywords to an ad group, add negative
 * keywords at campaign or ad-group level.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch, mutate } from "./api.js";
import { buildPage, errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;
const CRITERION_STATUSES = ["ENABLED", "PAUSED", "REMOVED"] as const;

const KeywordInput = z.object({
  text: z.string().min(1).describe("Testo della keyword, senza simboli di match type (es. 'scarpe eleganti donna')."),
  match_type: z.enum(MATCH_TYPES).describe("EXACT, PHRASE o BROAD."),
  cpc_bid_micros: z.number().int().positive().optional().describe("CPC bid manuale per questa keyword, in micros (opzionale).")
});

export function registerKeywordTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_keywords",
    {
      title: "List Keywords",
      description:
        "Elenca le parole chiave (positive) di un gruppo di annunci o dell'intero account, con stato, match type, bid e metriche. " +
        "Per le parole chiave negative usa google_ads_search con una query su 'campaign_criterion' o 'ad_group_criterion' filtrata su negative = true.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        ad_group_id: z.string().optional().describe("Se impostato, filtra solo le keyword di questo gruppo di annunci (solo l'ID numerico)."),
        status_filter: z.enum(CRITERION_STATUSES).optional().describe("Se impostato, filtra per stato. Default: tutte tranne REMOVED."),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Numero massimo di risultati.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, ad_group_id, status_filter, limit }, ctx): Promise<McpToolResult> => {
      try {
        const conditions = [status_filter ? `ad_group_criterion.status = '${status_filter}'` : `ad_group_criterion.status != 'REMOVED'`];
        if (ad_group_id) conditions.push(`ad_group.id = ${ad_group_id.replace(/[^0-9]/g, "")}`);
        const query =
          "SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, " +
          "ad_group_criterion.status, ad_group_criterion.cpc_bid_micros, ad_group_criterion.primary_status, " +
          "ad_group_criterion.primary_status_reasons, ad_group.id, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros " +
          `FROM keyword_view WHERE ${conditions.join(" AND ")} ORDER BY ad_group.id`;
        const result = await gaqlSearch(customer_id, query, limit, undefined, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, { customer_id, has_more: Boolean(result.nextPageToken) });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_add_keywords",
    {
      title: "Add Keywords",
      description: "Aggiunge una o piu' parole chiave (positive) a un gruppo di annunci esistente.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        ad_group_resource_name: z.string().min(1).describe("Resource name del gruppo di annunci, es. 'customers/1234567890/adGroups/555666'."),
        keywords: z.array(KeywordInput).min(1).max(50).describe("Elenco di keyword da aggiungere (max 50 per chiamata)."),
        status: z.enum(CRITERION_STATUSES).default("ENABLED").describe("Stato iniziale delle keyword.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, ad_group_resource_name, keywords, status }, ctx): Promise<McpToolResult> => {
      try {
        const operations = keywords.map(kw => ({
          create: {
            adGroup: ad_group_resource_name,
            status,
            keyword: { text: kw.text, matchType: kw.match_type },
            ...(kw.cpc_bid_micros !== undefined ? { cpcBidMicros: kw.cpc_bid_micros } : {})
          }
        }));
        const result = await mutate(customer_id, "adGroupCriteria", operations, true, ctx.mcpReq.signal);
        return jsonResult({ created: result.results, partial_failure_error: result.partialFailureError ?? null });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_add_negative_keywords",
    {
      title: "Add Negative Keywords",
      description:
        "Aggiunge una o piu' parole chiave negative a livello di campagna (bloccano la ricerca per TUTTI i gruppi di annunci della campagna) o di singolo gruppo di annunci.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        level: z.enum(["CAMPAIGN", "AD_GROUP"]).describe("A quale livello aggiungere le keyword negative."),
        resource_name: z
          .string()
          .min(1)
          .describe("Resource name della campagna (se level=CAMPAIGN) o del gruppo di annunci (se level=AD_GROUP)."),
        keywords: z.array(KeywordInput.omit({ cpc_bid_micros: true })).min(1).max(50).describe("Elenco di keyword negative da aggiungere.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, level, resource_name, keywords }, ctx): Promise<McpToolResult> => {
      try {
        if (level === "CAMPAIGN") {
          const operations = keywords.map(kw => ({
            create: { campaign: resource_name, negative: true, keyword: { text: kw.text, matchType: kw.match_type } }
          }));
          const result = await mutate(customer_id, "campaignCriteria", operations, true, ctx.mcpReq.signal);
          return jsonResult({ created: result.results, partial_failure_error: result.partialFailureError ?? null });
        }
        const operations = keywords.map(kw => ({
          create: { adGroup: resource_name, negative: true, keyword: { text: kw.text, matchType: kw.match_type } }
        }));
        const result = await mutate(customer_id, "adGroupCriteria", operations, true, ctx.mcpReq.signal);
        return jsonResult({ created: result.results, partial_failure_error: result.partialFailureError ?? null });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
