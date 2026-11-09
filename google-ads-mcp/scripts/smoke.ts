/**
 * Self-check: starts the built server over stdio and verifies its tool list
 * and basic input validation. It does NOT call the live Google Ads API,
 * because no real account/credentials are available yet for this project
 * (see README.md: "Valutazioni (Fase 4)"); once Alessio has live
 * credentials and an unblocked account, extend this script (or write proper
 * evaluations per the mcp-builder skill's evaluation guide) to exercise the
 * read-only tools against real data.
 *
 * Run with: npm run build && npm run smoke
 */
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const EXPECTED_TOOLS = [
  "google_ads_list_accessible_customers",
  "google_ads_get_customer",
  "google_ads_search",
  "google_ads_list_campaigns",
  "google_ads_create_campaign",
  "google_ads_create_shopping_campaign",
  "google_ads_create_performance_max_campaign",
  "google_ads_update_campaign",
  "google_ads_update_campaign_bidding_strategy",
  "google_ads_create_campaign_budget",
  "google_ads_update_campaign_budget",
  "google_ads_list_ad_groups",
  "google_ads_create_ad_group",
  "google_ads_update_ad_group",
  "google_ads_list_ads",
  "google_ads_create_responsive_search_ad",
  "google_ads_list_keywords",
  "google_ads_add_keywords",
  "google_ads_add_negative_keywords",
  "google_ads_list_conversion_actions",
  "google_ads_get_conversion_action",
  "google_ads_list_asset_groups",
  "google_ads_list_asset_group_assets",
  "google_ads_create_asset_group_listing_group_filter",
  "google_ads_get_merchant_center_link_status",
  "google_ads_audit_account_status",
  "google_ads_mutate"
].sort();

async function main(): Promise<void> {
  const client = new Client({ name: "smoke-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: { ...getDefaultEnvironment() }
    })
  );

  const { tools } = await client.listTools();
  const actualNames = tools.map(tool => tool.name).sort();
  assert.deepEqual(actualNames, EXPECTED_TOOLS, `Tool list mismatch.\nActual: ${JSON.stringify(actualNames)}`);
  console.error(`OK: ${tools.length} tool registrati e coincidono con l'elenco atteso.`);

  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 0, `${tool.name} non ha una description`);
    assert.ok(tool.annotations, `${tool.name} non ha annotations`);
  }
  console.error("OK: ogni tool ha description e annotations.");

  // Without credentials configured, any real call must fail with our own
  // actionable "missing env var" message, not a stack trace or a silent pass.
  const missingCredsCall = await client.callTool({
    name: "google_ads_list_accessible_customers",
    arguments: {}
  });
  assert.equal(missingCredsCall.isError, true, "una chiamata senza credenziali configurate deve restituire isError=true");
  const text = (missingCredsCall.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.ok(text.includes("Variabili d'ambiente mancanti"), `messaggio di errore inatteso: ${text}`);
  console.error("OK: senza credenziali, il tool fallisce con un messaggio chiaro su quale variabile manca.");

  // Input validation: a GAQL query under the 5-character minimum must be rejected before the handler runs.
  const invalidQuery = await client.callTool({
    name: "google_ads_search",
    arguments: { customer_id: "1234567890", query: "x" }
  });
  assert.equal(invalidQuery.isError, true, "una query troppo corta deve essere rifiutata dalla validazione dell'input");
  console.error("OK: la validazione dell'input rifiuta una query GAQL troppo corta.");

  await client.close();
  console.error("Smoke test superato.");
}

main().catch(error => {
  console.error("Smoke test FALLITO:", error);
  process.exit(1);
});
