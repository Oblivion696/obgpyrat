/**
 * google_ads_search - the single most important read tool. GAQL (Google Ads
 * Query Language) covers almost everything read-side: campaigns, ad groups,
 * ads, keywords, every metrics table, Shopping performance, PMax asset
 * groups, conversion actions, change history, and more.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch, GoogleAdsApiError } from "./api.js";
import { buildPage, errorResult, type McpToolResult } from "./format.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

const EXAMPLE_QUERIES = `
Esempi di query GAQL pronte all'uso (sostituisci i filtri secondo necessita):

1. Campagne attive con metriche degli ultimi 7 giorni:
   SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
          metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
   FROM campaign
   WHERE segments.date DURING LAST_7_DAYS AND campaign.status = 'ENABLED'
   ORDER BY metrics.cost_micros DESC

2. Performance Shopping (prodotto per prodotto), ultimi 30 giorni:
   SELECT segments.product_item_id, segments.product_title, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value, campaign.name
   FROM shopping_performance_view
   WHERE segments.date DURING LAST_30_DAYS

3. Asset group di una campagna Performance Max:
   SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.primary_status,
          asset_group.primary_status_reasons, campaign.id, campaign.name
   FROM asset_group
   WHERE campaign.id = 1234567890

4. Keyword con metriche e motivo di non idoneita (se presente):
   SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type, ad_group_criterion.status,
          ad_group_criterion.primary_status, ad_group_criterion.primary_status_reasons,
          metrics.impressions, metrics.clicks, metrics.cost_micros
   FROM keyword_view
   WHERE segments.date DURING LAST_14_DAYS

5. Azioni di conversione configurate sull'account:
   SELECT conversion_action.id, conversion_action.name, conversion_action.status,
          conversion_action.type, conversion_action.category, conversion_action.primary_for_goal
   FROM conversion_action

6. Stato di collegamento Google Merchant Center:
   SELECT merchant_center_link.id, merchant_center_link.merchant_id, merchant_center_link.status
   FROM merchant_center_link

7. Alberatura campagna > gruppo annunci > annuncio:
   SELECT campaign.name, ad_group.name, ad_group_ad.ad.id,
          ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.status
   FROM ad_group_ad
   WHERE campaign.status != 'REMOVED'

8. Motivo per cui una campagna non sta servendo (status "non primario"):
   SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons
   FROM campaign
   WHERE campaign.status = 'ENABLED'

9. Account clienti accessibili sotto un MCC (gerarchia):
   SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
          customer_client.time_zone, customer_client.manager, customer_client.status
   FROM customer_client

10. Strategia di offerta e target di una campagna:
    SELECT campaign.id, campaign.name, campaign.bidding_strategy_type,
           campaign.target_roas.target_roas, campaign.target_cpa.target_cpa_micros,
           campaign.maximize_conversion_value.target_roas
    FROM campaign
`.trim();

export function registerGaqlTools(server: McpServer): void {
  server.registerTool(
    "google_ads_search",
    {
      title: "GAQL Search",
      description:
        `Esegue una query GAQL (Google Ads Query Language) in sola lettura su un account Google Ads e restituisce le righe corrispondenti. ` +
        `Questo e' lo strumento di lettura PIU' POTENTE del server: copre campagne, gruppi di annunci, annunci, parole chiave, qualsiasi tabella di metriche, ` +
        `le performance Shopping (shopping_performance_view), gli asset group di Performance Max (asset_group), le azioni di conversione, il collegamento a Merchant Center, ` +
        `la cronologia modifiche e praticamente tutto il resto che l'API espone in lettura. Usalo ogni volta che un wrapper dedicato (es. google_ads_list_campaigns) non basta o manca.\n\n` +
        `Restituisce UNA pagina di risultati; se ce ne sono altre, la risposta include next_page_token da passare in page_token per la pagina successiva.\n\n` +
        EXAMPLE_QUERIES,
      inputSchema: z.strictObject({
        customer_id: z
          .string()
          .min(1)
          .describe(
            "ID del cliente Google Ads su cui eseguire la query, con o senza trattini (es. '123-456-7890' o '1234567890'). Ottienilo con google_ads_list_accessible_customers."
          ),
        query: z
          .string()
          .min(5)
          .describe(
            "La query GAQL completa, es. \"SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED'\". Vedi gli esempi nella descrizione del tool."
          ),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .default(DEFAULT_PAGE_SIZE)
          .describe(`Numero massimo di righe per pagina (1-${MAX_PAGE_SIZE}).`),
        page_token: z
          .string()
          .optional()
          .describe("Token della pagina successiva, ottenuto da una chiamata precedente (campo next_page_token).")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, query, page_size, page_token }, ctx): Promise<McpToolResult> => {
      try {
        const result = await gaqlSearch(customer_id, query, page_size, page_token, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, {
          customer_id,
          query,
          has_more: Boolean(result.nextPageToken),
          ...(result.nextPageToken ? { next_page_token: result.nextPageToken } : {})
        });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}

/** Shared by every tool file: turns a thrown error into readable tool text. */
export function formatToolError(error: unknown): string {
  if (error instanceof GoogleAdsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
