/**
 * Performance Max tools: list asset groups and their assets, and create
 * listing group filters (the feed segmentation tree that controls which
 * Merchant Center products flow into a given asset group).
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gaqlSearch, mutate } from "./api.js";
import { buildPage, errorResult, jsonResult, type McpToolResult } from "./format.js";
import { formatToolError } from "./gaql.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

export function registerAssetGroupTools(server: McpServer): void {
  server.registerTool(
    "google_ads_list_asset_groups",
    {
      title: "List Asset Groups",
      description:
        "Elenca gli Asset Group di una campagna Performance Max (o di tutto l'account), con stato e primary_status/primary_status_reasons " +
        "(utile per capire perche' un asset group non sta servendo, es. asset creativi insufficienti).",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        campaign_id: z.string().optional().describe("Se impostato, filtra solo gli asset group di questa campagna PMax (solo l'ID numerico)."),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Numero massimo di risultati.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, campaign_id, limit }, ctx): Promise<McpToolResult> => {
      try {
        const conditions = ["asset_group.status != 'REMOVED'"];
        if (campaign_id) conditions.push(`campaign.id = ${campaign_id.replace(/[^0-9]/g, "")}`);
        const query =
          "SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.primary_status, " +
          "asset_group.primary_status_reasons, asset_group.final_urls, campaign.id, campaign.name " +
          `FROM asset_group WHERE ${conditions.join(" AND ")} ORDER BY asset_group.id`;
        const result = await gaqlSearch(customer_id, query, limit, undefined, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, { customer_id, has_more: Boolean(result.nextPageToken) });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_list_asset_group_assets",
    {
      title: "List Asset Group Assets",
      description:
        "Elenca gli asset creativi (headline, descrizioni, immagini, loghi, video...) collegati a un Asset Group, con il loro ruolo (field_type) e stato di approvazione delle policy. " +
        "Usalo per verificare se un asset group PMax ha i contenuti minimi richiesti per poter servire.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        asset_group_id: z.string().min(1).describe("ID dell'asset group (solo l'ID numerico, senza 'assetGroups/')."),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE).describe("Numero massimo di risultati.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ customer_id, asset_group_id, limit }, ctx): Promise<McpToolResult> => {
      try {
        const query =
          "SELECT asset_group_asset.asset, asset_group_asset.field_type, asset_group_asset.status, " +
          "asset.id, asset.name, asset.type, asset.text_asset.text, asset.policy_summary.approval_status " +
          `FROM asset_group_asset WHERE asset_group.id = ${asset_group_id.replace(/[^0-9]/g, "")} ORDER BY asset_group_asset.field_type`;
        const result = await gaqlSearch(customer_id, query, limit, undefined, ctx.mcpReq.signal);
        const { page, text } = buildPage(result.results, { customer_id, asset_group_id, has_more: Boolean(result.nextPageToken) });
        return { content: [{ type: "text", text }], structuredContent: page };
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );

  server.registerTool(
    "google_ads_create_asset_group_listing_group_filter",
    {
      title: "Create Asset Group Listing Group Filter",
      description:
        "Crea un nodo del listing group filter di un Asset Group PMax, cioe' la regola che segmenta quali prodotti del feed Merchant Center alimentano quell'asset group. " +
        "Il caso piu' comune e il piu' semplice e' il nodo radice 'tutto il catalogo': chiama questo tool con type='UNIT_INCLUDED' e nessuna dimensione (lascia dimension_type non impostato) per includere TUTTI i prodotti nell'asset group. " +
        "Per segmentazioni piu' complesse (per marca, categoria, tipo prodotto, ecc. con piu' livelli) usa google_ads_mutate direttamente sulla risorsa assetGroupListingGroupFilters: questo tool copre solo un nodo alla volta.",
      inputSchema: z.strictObject({
        customer_id: z.string().min(1).describe("ID del cliente Google Ads."),
        asset_group_resource_name: z.string().min(1).describe("Resource name dell'asset group, es. 'customers/1234567890/assetGroups/555'."),
        type: z
          .enum(["UNIT_INCLUDED", "UNIT_EXCLUDED", "SUBDIVISION"])
          .default("UNIT_INCLUDED")
          .describe("UNIT_INCLUDED include i prodotti corrispondenti; UNIT_EXCLUDED li esclude; SUBDIVISION crea un nodo intermedio da suddividere ulteriormente."),
        parent_listing_group_filter_resource_name: z
          .string()
          .optional()
          .describe("Resource name del nodo padre, se questo non e' il nodo radice. Omettilo per il nodo radice."),
        dimension_type: z
          .enum(["PRODUCT_BRAND", "PRODUCT_CHANNEL", "PRODUCT_CONDITION", "PRODUCT_TYPE", "PRODUCT_ITEM_ID", "PRODUCT_CUSTOM_ATTRIBUTE"])
          .optional()
          .describe("Dimensione del prodotto su cui filtrare. Omettila per il nodo radice 'tutto il catalogo'."),
        dimension_value: z
          .string()
          .optional()
          .describe("Valore della dimensione (es. nome marca, valore del tipo prodotto, ID prodotto). Obbligatorio se dimension_type e' impostato."),
        custom_attribute_index: z
          .number()
          .int()
          .min(0)
          .max(4)
          .optional()
          .describe("Indice (0-4) dell'attributo personalizzato, solo se dimension_type=PRODUCT_CUSTOM_ATTRIBUTE."),
        product_type_level: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Livello (1-5) della tassonomia prodotto, solo se dimension_type=PRODUCT_TYPE.")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (
      {
        customer_id,
        asset_group_resource_name,
        type,
        parent_listing_group_filter_resource_name,
        dimension_type,
        dimension_value,
        custom_attribute_index,
        product_type_level
      },
      ctx
    ): Promise<McpToolResult> => {
      try {
        if (dimension_type && !dimension_value) {
          return errorResult("dimension_value e' obbligatorio quando dimension_type e' impostato.");
        }
        const filter: Record<string, unknown> = {
          assetGroup: asset_group_resource_name,
          type
        };
        if (parent_listing_group_filter_resource_name) {
          filter.parentListingGroupFilter = parent_listing_group_filter_resource_name;
        }
        if (dimension_type) {
          switch (dimension_type) {
            case "PRODUCT_BRAND":
              filter.caseValue = { productBrand: { value: dimension_value } };
              break;
            case "PRODUCT_CHANNEL":
              filter.caseValue = { productChannel: { channel: dimension_value } };
              break;
            case "PRODUCT_CONDITION":
              filter.caseValue = { productCondition: { condition: dimension_value } };
              break;
            case "PRODUCT_TYPE":
              filter.caseValue = { productType: { value: dimension_value, level: `LEVEL${product_type_level ?? 1}` } };
              break;
            case "PRODUCT_ITEM_ID":
              filter.caseValue = { productItemId: { value: dimension_value } };
              break;
            case "PRODUCT_CUSTOM_ATTRIBUTE":
              filter.caseValue = {
                productCustomAttribute: { value: dimension_value, index: `INDEX${custom_attribute_index ?? 0}` }
              };
              break;
          }
        }
        const result = await mutate(
          customer_id,
          "assetGroupListingGroupFilters",
          [{ create: filter }],
          false,
          ctx.mcpReq.signal
        );
        return jsonResult({ created: result.results });
      } catch (error) {
        return errorResult(formatToolError(error));
      }
    }
  );
}
