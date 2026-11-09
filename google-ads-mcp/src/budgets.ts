/**
 * Campaign Budget tools. A CampaignBudget must exist before a Campaign can
 * be created (campaigns reference a budget by resource name).
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { mutate } from "./api.js";
import { errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";

const DELIVERY_METHODS = ["STANDARD", "ACCELERATED"] as const;

export function registerBudgetTools(server: McpServer): void {
  server.registerTool(
    "google_ads_create_campaign_budget",
    {
      title: "Create Campaign Budget",
      description:
        "Crea un nuovo budget di campagna (CampaignBudget), necessario prima di poter creare qualsiasi campagna (Search, Shopping o Performance Max). " +
        "Il budget e' SEMPRE giornaliero: amount_micros e' l'importo in micro-unita di valuta (1 unita di valuta = 1.000.000 micros; es. per 20,00 EUR/giorno passa amount_micros=20000000). " +
        "Restituisce il resource_name del budget creato, da passare a google_ads_create_campaign / google_ads_create_shopping_campaign / google_ads_create_performance_max_campaign.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads su cui creare il budget."),
        name: z.string().min(1).describe("Nome del budget, univoco nell'account (es. 'Astero - Budget Shopping IT')."),
        amount_micros: z
          .number()
          .int()
          .positive()
          .describe("Importo giornaliero in micros (1.000.000 micros = 1 unita di valuta). Es. 20000000 = 20,00 EUR/giorno."),
        delivery_method: z
          .enum(DELIVERY_METHODS)
          .default("STANDARD")
          .describe("STANDARD distribuisce la spesa durante il giorno; ACCELERATED spende il budget il piu' rapidamente possibile."),
        explicitly_shared: z
          .boolean()
          .default(false)
          .describe("true se questo budget deve poter essere condiviso tra piu' campagne; false (default) per un budget dedicato a una sola campagna.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, name, amount_micros, delivery_method, explicitly_shared }, ctx): Promise<McpToolResult> => {
      try {
        const result = await mutate(
          customer_id,
          "campaignBudgets",
          [
            {
              create: {
                name,
                amountMicros: amount_micros,
                deliveryMethod: delivery_method,
                explicitlyShared: explicitly_shared
              }
            }
          ],
          false,
          ctx.mcpReq.signal
        );
        return jsonResult({ created: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_update_campaign_budget",
    {
      title: "Update Campaign Budget",
      description:
        "Aggiorna un budget di campagna esistente (importo giornaliero e/o metodo di erogazione). " +
        "Passa solo i campi che vuoi cambiare: solo quelli inviati verranno modificati.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        budget_resource_name: z
          .string()
          .min(1)
          .describe("Resource name del budget, es. 'customers/1234567890/campaignBudgets/987654'."),
        amount_micros: z.number().int().positive().optional().describe("Nuovo importo giornaliero in micros."),
        delivery_method: z.enum(DELIVERY_METHODS).optional().describe("Nuovo metodo di erogazione.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, budget_resource_name, amount_micros, delivery_method }, ctx): Promise<McpToolResult> => {
      try {
        const update: Record<string, unknown> = { resourceName: budget_resource_name };
        const maskFields: string[] = [];
        if (amount_micros !== undefined) {
          update.amountMicros = amount_micros;
          maskFields.push("amount_micros");
        }
        if (delivery_method !== undefined) {
          update.deliveryMethod = delivery_method;
          maskFields.push("delivery_method");
        }
        if (maskFields.length === 0) {
          return errorResult("Nessun campo da aggiornare: specifica amount_micros e/o delivery_method.");
        }
        const result = await mutate(
          customer_id,
          "campaignBudgets",
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
