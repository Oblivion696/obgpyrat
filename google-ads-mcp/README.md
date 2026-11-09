# Google Ads MCP Server

Server MCP (Model Context Protocol) che collega un'AI (es. Claude) all'**API di Google Ads**, con copertura ampia: ricerca GAQL universale, campagne Search/Display/Shopping/Performance Max, budget, gruppi di annunci, annunci RSA, parole chiave (positive e negative), strategie di offerta, azioni di conversione, Asset Group PMax, stato del collegamento a Google Merchant Center, un audit dello stato di idoneita' (primary status) e uno strumento avanzato "mutate" per tutto il resto.

Scritto in TypeScript con l'SDK ufficiale MCP v2 (`@modelcontextprotocol/server`), senza librerie a pagamento. Parla direttamente con l'endpoint REST di Google Ads (`https://googleads.googleapis.com`) usando `fetch`, senza la libreria client ufficiale `google-ads-api`: per un server che fa quasi solo GAQL + mutate su endpoint singoli, un wrapper REST leggero e' piu' semplice da controllare, da debuggare e non aggiunge una dipendenza pesante con la sua gestione gRPC. Se in futuro servissero funzionalita' molto avanzate non coperte dalla REST (raro), si potra' valutare la libreria ufficiale.

---

## 0. Novita' importanti 2026 (leggi prima di tutto)

**Il "sunset" del Developer Token (09/09/2026).** Da settembre 2026 Google ha cambiato come decide i permessi: il Developer Token (la stringa che si ottiene da un account Manager/MCC) viene ancora accettato come intestazione HTTP, ma **Google lo ignora** per decidere cosa puoi fare. Il livello di accesso (quante operazioni al giorno, quali account) e' ora legato al **progetto Google Cloud che ha generato le credenziali OAuth2** (client ID/secret), non al Developer Token. Questo server continua a richiedere e inviare il Developer Token (per compatibilita' e perche' alcuni strumenti/anteprime lo richiedono ancora), ma **il controllo reale dei tuoi limiti va fatto nella pagina "Google Ads API" della Google Cloud Console**, non piu' nel vecchio "API Center" di Google Ads.

**Livelli di accesso attuali**: Test (15.000 operazioni/giorno, solo account di test), Explorer (fino a 2.880 operazioni/giorno su account reali, nessuna verifica del brand richiesta), Basic (15.000 operazioni/giorno, richiede verifica del brand) e Standard (operazioni illimitate, richiede che il progetto sia gia' a livello Basic e supera una revisione manuale di Google di circa 10 giorni lavorativi). Per un singolo operatore come Astero/Noura, **Explorer o Basic bastano per iniziare**; valuta Standard solo se in futuro gestirai moltissimi account o moltissime chiamate al giorno.

---

## 1. Checklist: ottenere le credenziali (una tantum)

Segui questi passaggi UNA SOLA VOLTA (il refresh token che otterrai all'ultimo passo non scade mai, a meno che tu stesso non lo revochi).

### 1.1 Crea un progetto Google Cloud e attiva l'API

1. Vai su [console.cloud.google.com](https://console.cloud.google.com/) e crea un nuovo progetto (es. "astero-google-ads-mcp").
2. Nel menu, vai su **API e servizi > Libreria**, cerca **"Google Ads API"** e clicca **Attiva**.
3. Vai su **API e servizi > Schermata consenso OAuth**: scegli "Esterno" (External), compila i campi obbligatori (nome app, email di supporto) e salva. Non serve pubblicare l'app: in modalita' "Test" funziona lo stesso per il tuo uso personale (basta aggiungere il tuo indirizzo Google come "utente di test" nella stessa schermata).

### 1.2 Crea le credenziali OAuth2 (Client ID e Client Secret)

1. Vai su **API e servizi > Credenziali > Crea credenziali > ID client OAuth**.
2. Tipo di applicazione: **"App desktop"** (e' il tipo piu' semplice per il flusso che useremo al punto 1.4).
3. Dai un nome (es. "Google Ads MCP") e crea. Google ti mostra **Client ID** e **Client secret**: copiali, ti serviranno per `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET`.

### 1.3 Ottieni il Developer Token da un account Manager (MCC)

1. Se non hai ancora un account **Google Ads Manager (MCC)**, creane uno gratuitamente su [ads.google.com/home/tools/manager-accounts](https://ads.google.com/home/tools/manager-accounts/). Se gia' hai un MCC che gestisce Astero/Noura, usa quello.
2. Nell'MCC, vai su **Strumenti e impostazioni > Centro API** (o cerca "API Center" nelle impostazioni). Richiedi un Developer Token: viene assegnato immediatamente a livello "Test" (puoi usarlo fin da subito su account di test); per usarlo su account reali con operazioni di scrittura dovrai richiedere l'accesso Basic/Explorer (vedi sezione 0 sopra), compilando il modulo con una breve descrizione dell'uso (es. "gestione interna delle mie campagne Google Ads tramite un assistente AI personale").
3. Copia il token: ti serve per `GOOGLE_ADS_DEVELOPER_TOKEN`.
4. Se lavori attraverso l'MCC su un account cliente (es. l'MCC gestisce l'account Google Ads di Astero), annota anche l'**ID del tuo account Manager** (in alto a destra nell'interfaccia Google Ads, formato `123-456-7890`): ti servira' per `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (da inserire SENZA trattini, es. `1234567890`).

### 1.4 Genera il Refresh Token (flusso di consenso OAuth2, una tantum)

Il modo piu' semplice, senza scrivere o eseguire codice, e' usare l'**OAuth 2.0 Playground** di Google:

1. Vai su [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/).
2. Clicca l'icona a forma di ingranaggio (⚙️) in alto a destra. Spunta **"Use your own OAuth credentials"** e inserisci il Client ID e il Client Secret ottenuti al punto 1.2. Chiudi il pannello.
3. Nel riquadro a sinistra ("Step 1"), nel campo per inserire manualmente uno scope, scrivi: `https://www.googleapis.com/auth/adwords` e clicca **"Authorize APIs"**.
4. Accedi con l'account Google **collegato al tuo MCC** (quello che vedi/gestisci in Google Ads) e concedi il consenso. Se compare un avviso "Google non ha verificato questa app", clicca "Avanzate" poi "Vai su [nome app] (non sicuro)": e' normale per un'app in modalita' Test creata da te, nessun rischio dato che le credenziali sono tue.
5. Verrai riportato sull'OAuth Playground con un "Authorization code" gia' inserito. Clicca **"Exchange authorization code for tokens"** (Step 2).
6. Copia il valore di **"Refresh token"**: e' il valore per `GOOGLE_ADS_REFRESH_TOKEN`. (L'"Access token" mostrato qui scade dopo un'ora: il server lo rigenera da solo ogni volta usando il refresh token, quindi non ti serve copiarlo.)

Ora hai tutti e 4 i valori obbligatori: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, piu' eventualmente `GOOGLE_ADS_LOGIN_CUSTOMER_ID` se operi tramite un MCC.

---

## 2. Eseguire il server in locale (per provarlo)

1. Assicurati di avere **Node.js 20 o superiore** installato.
2. Nella cartella del progetto:
   ```
   npm install
   npm run build
   ```
3. Copia `.env.example` in `.env` e inserisci i valori ottenuti al punto 1.
4. Avvia il server in modalita' stdio (quella usata da Claude Desktop/MCP Inspector):
   ```
   npm start
   ```
   oppure, durante lo sviluppo con ricaricamento automatico: `npm run dev`.
5. Per ispezionarlo visivamente e provare i singoli strumenti senza scrivere codice, usa l'**MCP Inspector** ufficiale:
   ```
   npx @modelcontextprotocol/inspector node dist/index.js
   ```
   Si apre un'interfaccia web dove puoi chiamare ogni tool a mano e vedere la risposta.
6. Per provare la modalita' HTTP (quella usata una volta pubblicato online) in locale:
   ```
   TRANSPORT=http PORT=3000 npm start
   ```
   e poi visita `http://127.0.0.1:3000/healthz` per un controllo rapido.

---

## 3. Pubblicarlo gratis online (cosi' Claude puo' raggiungerlo da un URL)

**Scelta fatta per questo server: [Render.com](https://render.com), piano gratuito "Web Service".** E' una scelta indipendente e concreta: Render supporta nativamente Node.js/Express, non richiede carta di credito per il piano free, e i passaggi sono pochi e stabili nel tempo. (Limite noto: un Web Service gratuito su Render "si addormenta" dopo ~15 minuti senza richieste e si risveglia in 30-60 secondi alla chiamata successiva - vedi la sezione Rischi piu' in basso.)

### 3.1 Metti il codice su GitHub

1. Crea un repository GitHub (puo' essere privato) e caricaci questa cartella del progetto (`git init`, `git add`, `git commit`, `git push` - oppure usa l'interfaccia web di GitHub per caricare i file se preferisci non usare la riga di comando).
2. **IMPORTANTE**: non caricare mai il file `.env` con i valori reali (e' gia' escluso tramite `.gitignore`).

### 3.2 Crea il servizio su Render

1. Vai su [render.com](https://render.com), registrati (puoi farlo con l'account GitHub) e clicca **"New +" > "Web Service"**.
2. Collega il repository GitHub che hai creato al punto 3.1.
3. Configura cosi':
   - **Name**: `google-ads-mcp-server` (o quello che preferisci).
   - **Region**: Frankfurt (la piu' vicina all'Italia).
   - **Branch**: `main` (o quello che usi).
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**.
4. Nella sezione **"Environment Variables"**, aggiungi tutte queste (con i tuoi valori reali):
   - `GOOGLE_ADS_DEVELOPER_TOKEN`
   - `GOOGLE_ADS_CLIENT_ID`
   - `GOOGLE_ADS_CLIENT_SECRET`
   - `GOOGLE_ADS_REFRESH_TOKEN`
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (se operi tramite MCC)
   - `TRANSPORT` = `http`
   - `MCP_AUTH_TOKEN` = una password lunga e casuale generata da te (es. con `openssl rand -hex 32`) — OBBLIGATORIA, il server non parte senza.
   - `ALLOWED_HOSTS` = l'indirizzo che Render ti assegnera' (es. `google-ads-mcp-server.onrender.com`) - puoi completarlo dopo il primo deploy, quando Render ti mostra l'URL definitivo, e poi fare "Manual Deploy" di nuovo.
5. Clicca **"Create Web Service"**. Render fa build e deploy automaticamente; al termine ti da' un URL pubblico del tipo `https://google-ads-mcp-server.onrender.com`.
6. Verifica che funzioni visitando `https://<il-tuo-url>.onrender.com/healthz`: deve rispondere con `{"status":"ok", ...}`.
7. L'URL dell'endpoint MCP da usare in Claude e' `https://<il-tuo-url>.onrender.com/mcp`.

**Sicurezza: token obbligatorio.** Questo server, in modalita' HTTP, RICHIEDE una password propria (`MCP_AUTH_TOKEN`) oltre alle credenziali Google Ads: senza impostarla, il server si rifiuta di partire. Genera un valore lungo e casuale con `openssl rand -hex 32` (o un generatore di password online), impostalo come variabile d'ambiente `MCP_AUTH_TOKEN` su Render, E inserisci lo STESSO valore nel connettore claude.ai come header `Authorization: Bearer <il-tuo-token>` (vedi sezione 4). Senza il token corretto, ogni chiamata all'endpoint `/mcp` viene rifiutata con errore 401 — l'URL pubblico da solo non basta piu' per usare il server.

---

## 4. Aggiungere il server come connettore personalizzato in claude.ai

1. Vai su **claude.ai > Impostazioni > Connettori** (Settings > Connectors).
2. Clicca **"Aggiungi connettore personalizzato"** (Add custom connector).
3. Inserisci un nome (es. "Google Ads - Astero/Noura") e l'URL: `https://<il-tuo-url>.onrender.com/mcp`.
4. Nella sezione di autenticazione del connettore, scegli "Bearer token" (o equivalente header personalizzato) e inserisci lo STESSO valore di `MCP_AUTH_TOKEN` impostato su Render.
5. Salva. Claude elenchera' automaticamente tutti e 27 gli strumenti `google_ads_*` di questo server, pronti per essere usati in una conversazione.

---

## 5. Elenco completo degli strumenti

| Strumento | Descrizione breve |
|---|---|
| `google_ads_list_accessible_customers` | Elenca gli ID cliente raggiungibili con le credenziali configurate. |
| `google_ads_get_customer` | Dettagli base di un account (nome, valuta, fuso orario, MCC/test). |
| `google_ads_search` | Esegue una query GAQL grezza (lo strumento di lettura piu' potente: copre quasi tutto). |
| `google_ads_list_campaigns` | Elenca le campagne con stato, tipo, budget e metriche. |
| `google_ads_create_campaign_budget` | Crea un budget di campagna (giornaliero). |
| `google_ads_update_campaign_budget` | Aggiorna importo/metodo di erogazione di un budget. |
| `google_ads_create_campaign` | Crea una campagna Search o Display. |
| `google_ads_create_shopping_campaign` | Crea una campagna Shopping standard collegata a Merchant Center. |
| `google_ads_create_performance_max_campaign` | Crea una campagna Performance Max + il suo primo Asset Group. |
| `google_ads_update_campaign` | Aggiorna stato/nome di una campagna. |
| `google_ads_update_campaign_bidding_strategy` | Cambia strategia di offerta (manuale, Maximize Conversions/Value, Target CPA/ROAS). |
| `google_ads_list_ad_groups` | Elenca i gruppi di annunci. |
| `google_ads_create_ad_group` | Crea un gruppo di annunci. |
| `google_ads_update_ad_group` | Aggiorna stato/bid/nome di un gruppo di annunci. |
| `google_ads_list_ads` | Elenca gli annunci (con headline/descrizioni per le RSA). |
| `google_ads_create_responsive_search_ad` | Crea un annuncio Responsive Search Ad. |
| `google_ads_list_keywords` | Elenca le parole chiave positive con metriche. |
| `google_ads_add_keywords` | Aggiunge parole chiave positive a un gruppo di annunci. |
| `google_ads_add_negative_keywords` | Aggiunge parole chiave negative (a livello campagna o gruppo). |
| `google_ads_list_conversion_actions` | Elenca le azioni di conversione configurate sull'account. |
| `google_ads_get_conversion_action` | Dettagli completi di una singola azione di conversione. |
| `google_ads_list_asset_groups` | Elenca gli Asset Group di Performance Max con il loro stato. |
| `google_ads_list_asset_group_assets` | Elenca gli asset creativi di un Asset Group. |
| `google_ads_create_asset_group_listing_group_filter` | Crea un nodo di segmentazione del feed prodotti per un Asset Group PMax. |
| `google_ads_get_merchant_center_link_status` | Controlla lo stato del collegamento a Google Merchant Center. |
| `google_ads_audit_account_status` | Audit: mostra perche' campagne/gruppi non stanno servendo (primary_status). |
| `google_ads_mutate` | Escape hatch avanzato: qualsiasi operazione di mutate grezza, per cio' che non ha un tool dedicato. |

---

## 6. Rischi tecnici e limiti noti da tenere a mente

- **Risveglio lento su Render free**: dopo ~15 minuti di inattivita' il servizio si "addormenta"; la prima chiamata successiva puo' richiedere 30-60 secondi prima di rispondere (le chiamate successive sono rapide). Se questo diventa un problema, l'alternativa e' passare a un piano a pagamento di Render (pochi dollari/mese) o a un altro host sempre attivo.
- **Limiti di operazioni al giorno**: a livello Explorer sono solo 2.880 operazioni/giorno sull'account reale; a livello Basic 15.000/giorno. Una query GAQL conta come un numero di operazioni proporzionale alle righe restituite: query molto ampie (es. migliaia di keyword con metriche) possono consumare il limite rapidamente. Monitora l'uso e valuta l'upgrade a Standard solo se necessario.
- **Tempi di revisione per l'accesso Standard**: circa 10 giorni lavorativi, e Google fa una revisione manuale (puo' chiedere accesso demo se lo strumento verra' usato da altre persone oltre a te). Non serve per un uso puramente personale su un singolo account.
- **Versione dell'API**: questo server usa v26 (la versione stabile corrente a novembre 2026), configurabile tramite la variabile `GOOGLE_ADS_API_VERSION`. Google ritira (sunset) ogni versione circa un anno dopo il rilascio: controlla periodicamente la pagina ["Deprecation and sunset dates"](https://developers.google.com/google-ads/api/docs/sunset-dates) e aggiorna la variabile quando serve (nessuna modifica al codice e' necessaria per le versioni che non cambiano la forma delle risorse usate qui).
- **Quirk GAQL**: alcune combinazioni di campi non sono permesse nella stessa query (es. non tutte le metriche sono disponibili insieme a tutti i segmenti, e `shopping_performance_view` non supporta tutti i filtri di `campaign`). Se una query GAQL fallisce con un errore poco chiaro, provare a rimuovere un campo alla volta per isolare quello incompatibile.
- **Performance Max e' volutamente parziale**: questo server crea la campagna PMax e il primo Asset Group "contenitore", ma NON genera automaticamente gli asset creativi minimi (titoli, descrizioni, immagini, logo) richiesti perche' l'Asset Group possa servire: vanno aggiunti con `google_ads_mutate` sulla risorsa `assetGroupAssets` (upload di immagini/loghi richiede che l'asset sia prima caricato come risorsa `asset` con un URL immagine accessibile pubblicamente). Allo stesso modo, `google_ads_create_asset_group_listing_group_filter` copre un nodo alla volta: alberi di segmentazione prodotto complessi (piu' livelli) vanno costruiti con piu' chiamate o con `google_ads_mutate` in modalita' `grouped`.
- **Developer Token "ignorato"**: come spiegato nella sezione 0, dal settembre 2026 il controllo reale dei permessi e' sul progetto Google Cloud, non sul Developer Token. Se le chiamate falliscono con errori di permesso inattesi, controlla il livello di accesso nella Google Ads API Overview della Cloud Console, non solo il Developer Token.

---

## 7. Valutazioni (Fase 4) - da fare quando ci sara' un account reale

La Fase 4 del processo di sviluppo (creare 10 domande di valutazione end-to-end) e' stata **saltata intenzionalmente**: non esiste ancora un account Google Ads live con dati reali su cui verificare le risposte (l'account di Alessio e' bloccato/da sistemare, vedi le note del protocollo ads gestione). Quando Merchant Center e Google Ads saranno operativi con dati reali, creare un file di valutazione XML (formato descritto nella guida `evaluation.md` della skill `mcp-builder`) con 10 domande realistiche e verificabili (es. "quante campagne ENABLED ci sono e qual e' il loro costo totale negli ultimi 7 giorni?"), usando SOLO gli strumenti di lettura per generarle e verificarle.

---

## 8. Struttura del progetto

```
google-ads-mcp/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── src/
│   ├── constants.ts      # versione API, limiti, timeout
│   ├── auth.ts            # lettura env, refresh del token OAuth2 (con cache)
│   ├── api.ts             # client REST generico, GAQL search, mutate, errori GoogleAdsFailure
│   ├── format.ts          # helper di formattazione/paginazione risposte
│   ├── gaql.ts             # google_ads_search + helper errori condiviso
│   ├── accounts.ts         # list_accessible_customers, get_customer
│   ├── budgets.ts          # create/update campaign budget
│   ├── bidding.ts          # update_campaign_bidding_strategy + helper strategie condiviso
│   ├── campaigns.ts        # list/create/update campagne (Search/Display/Shopping/PMax)
│   ├── adgroups.ts         # list/create/update gruppi di annunci
│   ├── ads.ts              # list ads, create Responsive Search Ad
│   ├── keywords.ts         # list/add keyword positive e negative
│   ├── conversions.ts      # list/get conversion actions
│   ├── assetgroups.ts      # list asset group/assets, create listing group filter
│   ├── merchant.ts         # stato collegamento Merchant Center
│   ├── audit.ts            # audit primary_status campagne/gruppi
│   ├── mutate.ts            # escape hatch google_ads_mutate
│   ├── server.ts           # createServer(): registra tutti i tool
│   └── index.ts            # entry point, selezione trasporto stdio/http
└── scripts/
    └── smoke.ts            # self-check: verifica l'elenco strumenti e la validazione input
```
