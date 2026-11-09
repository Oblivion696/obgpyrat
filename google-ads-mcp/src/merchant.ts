/**
 * Merchant Center link diagnostics. Alessio's Merchant Center accounts have
 * had suspension issues before, so this status check matters a lot for his
 * audit protocol: if the link itself is broken/suspended, no Shopping or
 * feed-based PMax campaign can serve regardless of anything else.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch } from "./api.js";
import { errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";

export function registerMerchantTools(server: McpServer): void {
  server.registerTool(
    "google_ads_get_merchant_center_link_status",
    {
      title: "Get Merchant Center Link Status",
      description:
        "Controlla lo stato del collegamento tra l'account Google Ads e Google Merchant Center (merchant_center_link): ID dell'account Merchant Center collegato e stato del collegamento " +
        "(ENABLED, PENDING, INACTIVE, ecc.). Se il collegamento non e' ENABLED, NESSUNA campagna Shopping o Performance Max guidata dal feed puo' servire, indipendentemente da budget/offerte/asset: controlla sempre questo PRIMA di diagnosticare altri problemi di una campagna Shopping/PMax. " +
        "Per le metriche di vendita prodotto-per-prodotto usa google_ads_search su 'shopping_performance_view'.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id }, ctx): Promise<McpToolResult> => {
      try {
        const query = "SELECT merchant_center_link.id, merchant_center_link.merchant_id, merchant_center_link.status FROM merchant_center_link";
        const result = await gaqlSearch(customer_id, query, 50, undefined, ctx.mcpReq.signal);
        if (result.results.length === 0) {
          return jsonResult({
            customer_id,
            links: [],
            nota: "Nessun collegamento Merchant Center trovato su questo account Google Ads. Vai su Google Merchant Center > Impostazioni account > Collegamenti account per collegarlo, oppure verifica di avere il customer_id corretto."
          });
        }
        return jsonResult({ customer_id, links: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
