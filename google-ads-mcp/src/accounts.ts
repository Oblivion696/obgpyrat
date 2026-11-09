/**
 * Account-level tools: discovering accessible customer IDs and reading one
 * customer's basic details (name, currency, time zone, manager/test flags).
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { googleAdsRequest } from "./api.js";
import { errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_accessible_customers",
    {
      title: "List Accessible Customers",
      description:
        "Elenca gli ID cliente Google Ads (customer ID) raggiungibili con le credenziali OAuth2 configurate su questo server. " +
        "E' il primo strumento da chiamare per scoprire quali account (o l'account Manager/MCC) sono visibili, prima di usare google_ads_search o qualsiasi altro strumento che richiede un customer_id. " +
        "Nota: se usi un account Manager (MCC), questo elenco mostra gli ID direttamente collegati alle credenziali, non necessariamente tutti i clienti sotto il MCC: per la gerarchia completa usa google_ads_search con 'FROM customer_client'.",
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (_args, ctx): Promise<McpToolResult> => {
      try {
        const raw = await googleAdsRequest<{ resourceNames?: string[] }>(
          "GET",
          "customers:listAccessibleCustomers",
          undefined,
          ctx.mcpReq.signal
        );
        const customerIds = (raw.resourceNames ?? []).map(rn => rn.replace("customers/", ""));
        return jsonResult({ count: customerIds.length, customer_ids: customerIds });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_get_customer",
    {
      title: "Get Customer",
      description:
        "Recupera i dettagli base di un account Google Ads: nome descrittivo, valuta, fuso orario, se e' un account Manager (MCC) e se e' un account di test. " +
        "Usalo per confermare su quale account stai operando prima di fare modifiche.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads, con o senza trattini.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id }, ctx): Promise<McpToolResult> => {
      try {
        const normalized = customer_id.replace(/[^0-9]/g, "");
        const raw = await googleAdsRequest<Record<string, unknown>>(
          "GET",
          `customers/${normalized}`,
          undefined,
          ctx.mcpReq.signal
        );
        return jsonResult({ customer: raw });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
