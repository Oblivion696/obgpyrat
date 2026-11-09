/**
 * Server factory: builds a fresh McpServer and registers every tool module
 * on it. Called once per stdio connection, and once per HTTP request (so the
 * HTTP server keeps no state between requests).
 */
import { McpServer } from "@modelcontextprotocol/server";
import { registerGaqlTools } from "./gaql.js";
import { registerAccountTools } from "./accounts.js";
import { registerBudgetTools } from "./budgets.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerBiddingTools } from "./bidding.js";
import { registerAdGroupTools } from "./adgroups.js";
import { registerAdTools } from "./ads.js";
import { registerKeywordTools } from "./keywords.js";
import { registerConversionTools } from "./conversions.js";
import { registerAssetGroupTools } from "./assetgroups.js";
import { registerMerchantTools } from "./merchant.js";
import { registerAuditTools } from "./audit.js";
import { registerMutateTools } from "./mutate.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "google-ads-mcp-server", version: "1.0.0" });

  registerAccountTools(server);
  registerGaqlTools(server);
  registerCampaignTools(server);
  registerBudgetTools(server);
  registerBiddingTools(server);
  registerAdGroupTools(server);
  registerAdTools(server);
  registerKeywordTools(server);
  registerConversionTools(server);
  registerAssetGroupTools(server);
  registerMerchantTools(server);
  registerAuditTools(server);
  registerMutateTools(server);

  return server;
}
