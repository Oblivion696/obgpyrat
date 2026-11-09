#!/usr/bin/env node
/**
 * Entry point. Serves stdio by default (for local use / MCP Inspector / a
 * desktop host launching this as a subprocess), or Streamable HTTP when
 * TRANSPORT=http (for a remote deployment added as a custom connector).
 *
 * Credential env vars (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
 * GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN) are validated lazily,
 * the first time a tool actually calls the Google Ads API - not at startup -
 * so the server still starts (and e.g. `tools/list` still works) even before
 * credentials are configured. See src/auth.ts.
 */
import { createServer } from "./server.js";

async function main(): Promise<void> {
  if (process.env.TRANSPORT === "http") {
    const { createMcpExpressApp } = await import("@modelcontextprotocol/express");
    const { toNodeHandler } = await import("@modelcontextprotocol/node");
    const { createMcpHandler } = await import("@modelcontextprotocol/server");

    // Obbligatorio in modalita' http: senza questo token chiunque conosca
    // l'URL pubblico potrebbe pilotare l'account Google Ads. Il server si
    // rifiuta di partire senza, cosi' non si rischia di esporlo per errore.
    const authToken = process.env.MCP_AUTH_TOKEN?.trim();
    if (!authToken) {
      console.error(
        "Errore fatale: TRANSPORT=http richiede MCP_AUTH_TOKEN impostato " +
          "(una password lunga e casuale a tua scelta). Genera un valore, " +
          "es. con `openssl rand -hex 32`, e impostalo come variabile " +
          "d'ambiente MCP_AUTH_TOKEN sia qui che nel connettore claude.ai " +
          "(header 'Authorization: Bearer <token>')."
      );
      process.exit(1);
    }

    const handler = createMcpHandler(createServer);
    const allowedHostsEnv = process.env.ALLOWED_HOSTS?.trim();
    const app = createMcpExpressApp({
      host: "0.0.0.0",
      ...(allowedHostsEnv ? { allowedHosts: allowedHostsEnv.split(",").map(h => h.trim()) } : {})
    });

    function requireBearerToken(
      req: import("http").IncomingMessage,
      res: import("http").ServerResponse
    ): boolean {
      const header = req.headers["authorization"];
      const expected = `Bearer ${authToken}`;
      if (header !== expected) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "unauthorized", message: "Authorization: Bearer <token> mancante o errato." }));
        return false;
      }
      return true;
    }

    const nodeHandler = toNodeHandler(handler);
    app.all("/mcp", (req, res) => {
      if (!requireBearerToken(req, res)) return;
      void nodeHandler(req, res, req.body);
    });

    app.get("/healthz", (_req, res) => {
      res.status(200).json({ status: "ok", server: "google-ads-mcp-server" });
    });

    const port = Number(process.env.PORT || 3000);
    app.listen(port, "0.0.0.0", () => {
      console.error(`google-ads-mcp-server in ascolto su http://0.0.0.0:${port}/mcp (Streamable HTTP)`);
    });
  } else {
    const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
    serveStdio(createServer);
    console.error("google-ads-mcp-server in esecuzione su stdio");
  }
}

main().catch(error => {
  console.error("Errore fatale all'avvio del server:", error);
  process.exit(1);
});
