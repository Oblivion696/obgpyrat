/**
 * Generic escape-hatch mutate tool. Exists so an agent is never blocked by a
 * resource this server hasn't wrapped with a dedicated tool, at the cost of
 * requiring the caller to know the Google Ads API's raw mutate JSON shape.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { mutate as mutateSingle, mutateGrouped } from "./api.js";
import { errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";

export function registerMutateTools(server: McpServer): void {
  server.registerTool(
    "google_ads_mutate",
    {
      title: "Generic Mutate (Advanced Escape Hatch)",
      description:
        "ATTENZIONE - strumento avanzato per utenti esperti. Esegue operazioni di mutate GREZZE (create/update/remove) direttamente contro l'API Google Ads, " +
        "per QUALSIASI tipo di risorsa che non ha un tool dedicato in questo server (es. campaign_criterion a livello di posizionamento geografico, ad_schedule, " +
        "frequency_cap, extension/asset link avanzati, bid modifiers, ecc.). " +
        "Operazioni malformate possono causare modifiche indesiderate sull'account (creare, modificare o RIMUOVERE risorse reali con conseguenze reali, inclusa spesa pubblicitaria). " +
        "USA I TOOL SPECIFICI (google_ads_create_campaign, google_ads_add_keywords, ecc.) QUANDO ESISTONO: sono piu' sicuri perche' validano i campi minimi. " +
        "Usa questo tool solo quando non esiste un tool dedicato, e valida con attenzione ogni operazione prima di eseguirla (idealmente prima con partial_failure=true su un singolo elemento di test).\n\n" +
        "Modalita' 'single' (default): tutte le operazioni vanno sullo STESSO tipo di risorsa. resource_path e' il nome della collezione come appare nell'URL REST in camelCase plurale " +
        "(es. 'campaigns', 'adGroups', 'adGroupCriteria', 'campaignCriteria', 'assetGroupListingGroupFilters', 'conversionActions'). " +
        "Ogni elemento di operations e' uno tra: {\"create\": {...campi della risorsa...}}, {\"update\": {\"resourceName\": \"...\", ...campi da cambiare...}, \"updateMask\": \"campo1,campo2\"}, oppure {\"remove\": \"customers/123/campaigns/456\"}.\n\n" +
        "Modalita' 'grouped': usa l'endpoint googleAds:mutate per creare/collegare PIU' tipi di risorsa in una sola chiamata atomica (es. budget + campagna + gruppo di annunci insieme). " +
        "Ogni elemento di operations deve avere la forma {\"campaignOperation\": {\"create\": {...}}} oppure {\"campaignBudgetOperation\": {...}} ecc. " +
        "Usa resource name temporanei con ID negativi (es. 'customers/123/campaigns/-1') per collegare risorse create nella stessa chiamata.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads su cui eseguire le operazioni."),
        mode: z.enum(["single", "grouped"]).default("single").describe("'single' per operazioni su un solo tipo di risorsa, 'grouped' per l'endpoint googleAds:mutate multi-risorsa."),
        resource_path: z
          .string()
          .optional()
          .describe("Obbligatorio se mode='single'. Nome della collezione REST in camelCase plurale, es. 'campaigns', 'adGroups', 'adGroupCriteria'."),
        operations: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(50)
          .describe("Le operazioni di mutate grezze, nella forma che l'API Google Ads REST si aspetta (vedi la descrizione del tool per gli esempi esatti)."),
        partial_failure: z
          .boolean()
          .default(false)
          .describe("Se true, le operazioni valide vengono eseguite anche se altre nella stessa chiamata falliscono (utile per batch grandi); se false (default), devono riuscire TUTTE o nessuna.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, mode, resource_path, operations, partial_failure }, ctx): Promise<McpToolResult> => {
      try {
        if (mode === "single") {
          if (!resource_path) {
            return errorResult("resource_path e' obbligatorio quando mode='single' (es. 'campaigns', 'adGroups').");
          }
          const result = await mutateSingle(customer_id, resource_path, operations, partial_failure, ctx.mcpReq.signal);
          return jsonResult({ results: result.results, partial_failure_error: result.partialFailureError ?? null });
        }
        const result = await mutateGrouped(customer_id, operations, partial_failure, ctx.mcpReq.signal);
        return jsonResult({ results: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
