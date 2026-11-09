/**
 * Campaign tools: list (GAQL convenience wrapper), create (Search/Display),
 * create Shopping, create Performance Max, and update (status/name).
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch, mutate, mutateGrouped } from "./api.js";
import { buildPage, errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";
import { buildBiddingField, BIDDING_STRATEGY_TYPES, type BiddingStrategyType } from "./bidding.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

const CAMPAIGN_STATUSES = ["ENABLED", "PAUSED", "REMOVED"] as const;
const ADVERTISING_CHANNEL_TYPES = ["SEARCH", "DISPLAY"] as const;

function normalizeId(id: string): string {
  return id.replace(/[^0-9]/g, "");
}

export function registerCampaignTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_campaigns",
    {
      title: "List Campaigns",
      description:
        "Elenca le campagne di un account, con stato, tipo, budget e (opzionalmente) metriche di base su un intervallo di date. " +
        "Wrapper comodo su google_ads_search per il caso d'uso piu' comune; per filtri avanzati usa direttamente google_ads_search con una query GAQL su 'campaign'.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        status_filter: z
          .enum(CAMPAIGN_STATUSES)
          .optional()
          .describe("Se impostato, restituisce solo le campagne con questo stato. Default: tutte tranne REMOVED."),
        include_metrics: z
          .boolean()
          .default(true)
          .describe("Se true, include impressions/clicks/cost/conversions/conversions_value su date_range."),
        date_range: z
          .enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"])
          .default("LAST_7_DAYS")
          .describe("Intervallo di date per le metriche, se include_metrics=true."),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Numero massimo di campagne da restituire.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, status_filter, include_metrics, date_range, limit }, ctx): Promise<McpToolResult> => {
      try {
        const fields = [
          "campaign.id",
          "campaign.name",
          "campaign.status",
          "campaign.primary_status",
          "campaign.primary_status_reasons",
          "campaign.advertising_channel_type",
          "campaign.bidding_strategy_type",
          "campaign_budget.amount_micros"
        ];
        if (include_metrics) {
          fields.push(
            "metrics.impressions",
            "metrics.clicks",
            "metrics.cost_micros",
            "metrics.conversions",
            "metrics.conversions_value"
          );
        }
        const conditions = [status_filter ? `campaign.status = '${status_filter}'` : `campaign.status != 'REMOVED'`];
        if (include_metrics) conditions.push(`segments.date DURING ${date_range}`);
        const query = `SELECT ${fields.join(", ")} FROM campaign WHERE ${conditions.join(" AND ")} ORDER BY campaign.id`;

        const result = await gaqlSearch(customer_id, query, limit, undefined, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, { customer_id, has_more: Boolean(result.nextPageToken) });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_campaign",
    {
      title: "Create Campaign (Search/Display)",
      description:
        "Crea una nuova campagna Search o Display. Richiede un budget gia' creato con google_ads_create_campaign_budget. " +
        "Per prudenza la campagna viene creata in stato PAUSED di default: usa google_ads_update_campaign per attivarla (ENABLED) quando sei pronto. " +
        "Per campagne Shopping o Performance Max usa i tool dedicati google_ads_create_shopping_campaign / google_ads_create_performance_max_campaign.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        name: z.string().min(1).describe("Nome della campagna, univoco nell'account."),
        advertising_channel_type: z.enum(ADVERTISING_CHANNEL_TYPES).describe("SEARCH o DISPLAY."),
        campaign_budget_resource_name: z
          .string()
          .min(1)
          .describe("Resource name del budget, es. 'customers/1234567890/campaignBudgets/987654'."),
        bidding_strategy_type: z.enum(BIDDING_STRATEGY_TYPES).default("MAXIMIZE_CONVERSIONS").describe("Strategia di offerta iniziale."),
        target_roas: z.number().positive().optional().describe("Obbligatorio se bidding_strategy_type=TARGET_ROAS."),
        target_cpa_micros: z.number().int().positive().optional().describe("Obbligatorio se bidding_strategy_type=TARGET_CPA."),
        status: z.enum(CAMPAIGN_STATUSES).default("PAUSED").describe("Stato iniziale della campagna."),
        start_date: z.string().optional().describe("Data di inizio in formato YYYY-MM-DD (default: oggi)."),
        end_date: z.string().optional().describe("Data di fine in formato YYYY-MM-DD (opzionale, nessuna scadenza se omessa).")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (
      {
        customer_id,
        name,
        advertising_channel_type,
        campaign_budget_resource_name,
        bidding_strategy_type,
        target_roas,
        target_cpa_micros,
        status,
        start_date,
        end_date
      },
      ctx
    ): Promise<McpToolResult> => {
      try {
        const { field } = buildBiddingField(bidding_strategy_type as BiddingStrategyType, target_roas, target_cpa_micros);
        const campaign: Record<string, unknown> = {
          name,
          status,
          advertisingChannelType: advertising_channel_type,
          campaignBudget: campaign_budget_resource_name,
          ...field
        };
        if (advertising_channel_type === "SEARCH") {
          campaign.networkSettings = {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false
          };
        }
        if (start_date) campaign.startDate = start_date.replace(/-/g, "");
        if (end_date) campaign.endDate = end_date.replace(/-/g, "");

        const result = await mutate(customer_id, "campaigns", [{ create: campaign }], false, ctx.mcpReq.signal);
        return jsonResult({ created: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_shopping_campaign",
    {
      title: "Create Shopping Campaign",
      description:
        "Crea una campagna Shopping standard, collegata al catalogo prodotti di Google Merchant Center. " +
        "Richiede un budget (google_ads_create_campaign_budget) e il Merchant Center ID collegato all'account Google Ads (usa google_ads_get_merchant_center_link_status per trovarlo/verificarlo). " +
        "Creata in stato PAUSED di default per sicurezza.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        name: z.string().min(1).describe("Nome della campagna."),
        campaign_budget_resource_name: z.string().min(1).describe("Resource name del budget."),
        merchant_center_id: z.string().min(1).describe("ID dell'account Google Merchant Center collegato (solo cifre)."),
        feed_label: z
          .string()
          .min(2)
          .describe("Feed label dei prodotti da includere, tipicamente il codice paese del feed (es. 'IT', 'US')."),
        campaign_priority: z
          .number()
          .int()
          .min(0)
          .max(2)
          .default(0)
          .describe("Priorita' della campagna Shopping (0=bassa, 1=media, 2=alta); rilevante solo se piu' campagne Shopping condividono lo stesso prodotto."),
        bidding_strategy_type: z
          .enum(["MANUAL_CPC", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"])
          .default("MAXIMIZE_CONVERSION_VALUE")
          .describe("Strategia di offerta (le campagne Shopping standard non supportano MAXIMIZE_CONVERSIONS/TARGET_CPA)."),
        target_roas: z.number().positive().optional().describe("Obbligatorio se bidding_strategy_type=TARGET_ROAS."),
        status: z.enum(CAMPAIGN_STATUSES).default("PAUSED").describe("Stato iniziale della campagna.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (
      {
        customer_id,
        name,
        campaign_budget_resource_name,
        merchant_center_id,
        feed_label,
        campaign_priority,
        bidding_strategy_type,
        target_roas,
        status
      },
      ctx
    ): Promise<McpToolResult> => {
      try {
        const { field } = buildBiddingField(bidding_strategy_type as BiddingStrategyType, target_roas, undefined);
        const campaign: Record<string, unknown> = {
          name,
          status,
          advertisingChannelType: "SHOPPING",
          campaignBudget: campaign_budget_resource_name,
          shoppingSetting: {
            merchantId: normalizeId(merchant_center_id),
            feedLabel: feed_label,
            campaignPriority: campaign_priority,
            enableLocal: false
          },
          ...field
        };
        const result = await mutate(customer_id, "campaigns", [{ create: campaign }], false, ctx.mcpReq.signal);
        return jsonResult({ created: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_performance_max_campaign",
    {
      title: "Create Performance Max Campaign",
      description:
        "Crea una campagna Performance Max (PMax) insieme al suo primo Asset Group, in un'unica chiamata atomica. " +
        "Richiede un budget e una strategia di offerta a valore (MAXIMIZE_CONVERSION_VALUE o TARGET_ROAS). " +
        "Se merchant_center_id e feed_label sono forniti, la campagna viene collegata al feed prodotti (PMax guidata dal feed, il caso tipico per e-commerce come Astero/Noura). " +
        "ATTENZIONE: l'Asset Group creato qui e' solo un contenitore con gli URL finali; PRIMA che possa servire traffico devi ancora aggiungere gli asset creativi minimi richiesti (headline, descrizioni, immagini, loghi) con google_ads_mutate su assetGroupAssets, e idealmente dei listing group filter con google_ads_create_asset_group_listing_group_filter. Creata in stato PAUSED per sicurezza.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        name: z.string().min(1).describe("Nome della campagna."),
        campaign_budget_resource_name: z.string().min(1).describe("Resource name del budget."),
        bidding_strategy_type: z
          .enum(["MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"])
          .default("MAXIMIZE_CONVERSION_VALUE")
          .describe("Le campagne PMax richiedono una strategia basata sul valore."),
        target_roas: z.number().positive().optional().describe("Obbligatorio se bidding_strategy_type=TARGET_ROAS."),
        asset_group_name: z.string().min(1).describe("Nome del primo asset group (es. 'Astero - Gruppo principale')."),
        final_urls: z
          .array(z.string().url())
          .min(1)
          .describe("URL finali (pagine di destinazione) dell'asset group, es. ['https://asteroboutique.shop/']."),
        merchant_center_id: z.string().optional().describe("ID Google Merchant Center, per una PMax guidata dal feed prodotti."),
        feed_label: z.string().optional().describe("Feed label dei prodotti da includere (es. 'IT'). Usalo insieme a merchant_center_id."),
        status: z.enum(CAMPAIGN_STATUSES).default("PAUSED").describe("Stato iniziale della campagna.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (
      {
        customer_id,
        name,
        campaign_budget_resource_name,
        bidding_strategy_type,
        target_roas,
        asset_group_name,
        final_urls,
        merchant_center_id,
        feed_label,
        status
      },
      ctx
    ): Promise<McpToolResult> => {
      try {
        const { field } = buildBiddingField(bidding_strategy_type as BiddingStrategyType, target_roas, undefined);
        const normalizedCustomerId = normalizeId(customer_id);
        const tempCampaignResourceName = `customers/${normalizedCustomerId}/campaigns/-1`;

        const campaign: Record<string, unknown> = {
          resourceName: tempCampaignResourceName,
          name,
          status,
          advertisingChannelType: "PERFORMANCE_MAX",
          campaignBudget: campaign_budget_resource_name,
          ...field
        };
        if (merchant_center_id && feed_label) {
          campaign.shoppingSetting = { merchantId: normalizeId(merchant_center_id), feedLabel: feed_label };
        }

        const assetGroup: Record<string, unknown> = {
          name: asset_group_name,
          campaign: tempCampaignResourceName,
          finalUrls: final_urls,
          status: "ENABLED"
        };

        const result = await mutateGrouped(
          customer_id,
          [{ campaignOperation: { create: campaign } }, { assetGroupOperation: { create: assetGroup } }],
          false,
          ctx.mcpReq.signal
        );
        return jsonResult({
          created: result.results,
          nota: "Asset group creato come contenitore. Aggiungi ora gli asset creativi minimi (headline, descrizioni, immagini, loghi) prima di attivare la campagna."
        });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_update_campaign",
    {
      title: "Update Campaign",
      description:
        "Aggiorna una campagna esistente: stato (ENABLED/PAUSED/REMOVED) e/o nome. Per cambiare la strategia di offerta usa google_ads_update_campaign_bidding_strategy. " +
        "REMOVED rimuove la campagna in modo permanente dall'interfaccia (resta visibile solo nello storico/report).",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        campaign_resource_name: z.string().min(1).describe("Resource name della campagna, es. 'customers/1234567890/campaigns/111222333'."),
        status: z.enum(CAMPAIGN_STATUSES).optional().describe("Nuovo stato."),
        name: z.string().min(1).optional().describe("Nuovo nome.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ customer_id, campaign_resource_name, status, name }, ctx): Promise<McpToolResult> => {
      try {
        const update: Record<string, unknown> = { resourceName: campaign_resource_name };
        const maskFields: string[] = [];
        if (status !== undefined) {
          update.status = status;
          maskFields.push("status");
        }
        if (name !== undefined) {
          update.name = name;
          maskFields.push("name");
        }
        if (maskFields.length === 0) {
          return errorResult("Nessun campo da aggiornare: specifica status e/o name.");
        }
        const result = await mutate(
          customer_id,
          "campaigns",
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
