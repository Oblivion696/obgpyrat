/**
 * Conversion Action tools (read-only): important for this operator's
 * tracking audits (Shopify + Pixel/CAPI + Google Ads conversion import).
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch, googleAdsRequest } from "./api.js";
import { buildPage, errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

export function registerConversionTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_conversion_actions",
    {
      title: "List Conversion Actions",
      description:
        "Elenca tutte le azioni di conversione configurate sull'account (acquisti, lead, ecc.), con stato, tipo, categoria e se sono usate come obiettivo primario. " +
        "Fondamentale per verificare che il tracciamento (Shopify + Pixel/CAPI + importazione conversioni) sia impostato correttamente prima di affidare la gestione delle offerte automatiche (TARGET_ROAS/TARGET_CPA) a un algoritmo.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Numero massimo di risultati.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, limit }, ctx): Promise<McpToolResult> => {
      try {
        const query =
          "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, " +
          "conversion_action.category, conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric, " +
          "conversion_action.counting_type, conversion_action.value_settings.default_value, conversion_action.value_settings.default_currency_code " +
          "FROM conversion_action ORDER BY conversion_action.id";
        const result = await gaqlSearch(customer_id, query, limit, undefined, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, { customer_id, has_more: Boolean(result.nextPageToken) });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_conversion_action",
    {
      title: "Get Conversion Action",
      description: "Recupera i dettagli completi di una singola azione di conversione dal suo resource name.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        conversion_action_resource_name: z
          .string()
          .min(1)
          .describe("Resource name, es. 'customers/1234567890/conversionActions/987654321'.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, conversion_action_resource_name }, ctx): Promise<McpToolResult> => {
      try {
        const normalized = customer_id.replace(/[^0-9]/g, "");
        const idPart = conversion_action_resource_name.split("/").pop();
        const raw = await googleAdsRequest<Record<string, unknown>>(
          "GET",
          `customers/${normalized}/conversionActions/${idPart}`,
          undefined,
          ctx.mcpReq.signal
        );
        return jsonResult({ conversion_action: raw });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
