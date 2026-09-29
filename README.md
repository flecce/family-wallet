# Family Wallet

App web mobile-first per segnare le spese di famiglia e vedere, mese per mese, **chi deve dare a chi**.
È un sito statico (HTML + JS + CSS, nessun backend) pubblicato su GitHub Pages; le spese stanno in un
**Google Sheet** o in un **file Excel su OneDrive** di chi crea il wallet.

## Cosa fa

- Login con **Google** o **Microsoft** (direttamente dal browser).
- Home con tutti i wallet a cui hai accesso e due azioni: **Crea wallet** e **Accedi a wallet** (codice + password).
- **Wallet predefinito**: con la stella accanto a un wallet, l'app lo apre direttamente all'avvio
  (la scelta è salvata nel browser, quindi vale per quel dispositivo).
- Il wallet è un foglio di calcolo nel cloud del creatore:
  - utente Google → Google Sheets nel suo Drive;
  - utente Microsoft → file Excel in OneDrive (`App/Family Wallet`).
- Spese con data, nota, importo e persone tra cui dividerle (di default tutti).
- Vista mensile: totale, quanto ha pagato ognuno, e i pagamenti per pareggiare ("Fabiano deve 100,00 € a Selene").
- Lista spese per giorno con chi le ha fatte, filtrabile per persona.
- **Segna il mese come pagato** (e riaprilo): le spese di un mese pagato non si modificano.
- Ogni spesa può essere modificata o cancellata solo da chi l'ha inserita.
- **Demo** senza account: "Prova la demo" nella pagina di login (dati salvati nel browser).

### Il foglio

| Foglio | Contenuto |
| --- | --- |
| `Spese` | ID, Data, Nota, Importo (€), Pagato da (email), Pagato da, Diviso tra, Creata il, Modificata il |
| `Membri` | Email, Nome, Foto, Entrato il |
| `Mesi pagati` | Mese, Segnato da, Segnato il, Pagamenti (testo leggibile), Dettaglio (JSON) |
| `Info` | nome del wallet, proprietario, codice, hash della password |

### Codice e password

Alla creazione il foglio viene condiviso "chiunque abbia il link può modificare" e l'app genera il
**codice del wallet** (`G-…` per Google, `M-…` per Microsoft). Chi conosce codice e password entra
dalla home con **Accedi a wallet**, oppure dal link "Invia link" della scheda Membri.

Limiti da conoscere:

- Un wallet Google si usa con account Google, uno Microsoft con account Microsoft.
- La password è un controllo dell'app (nel foglio c'è solo il suo hash PBKDF2): chi ha il codice
  può comunque aprire il foglio direttamente. Tratta il codice come un segreto.
- Due modifiche nello stesso istante possono sovrascriversi (l'app rilegge il foglio subito prima di ogni scrittura, il che riduce il rischio senza eliminarlo).

## Configurazione

Servono solo i due **Client ID**. Vanno in [`js/config.js`](js/config.js) oppure, per non committarli, nelle
**variabili di Actions** del repository (Settings → Secrets and variables → Actions → Variables):
`FW_GOOGLE_CLIENT_ID`, `FW_MICROSOFT_CLIENT_ID`. Sono valori pubblici (finiscono nel browser), non segreti.

L'URL dell'app è `https://<utente>.github.io/<repo>/`, oppure quello del dominio personalizzato di GitHub Pages
se l'account ne ha uno: qui è **`https://lecce.dev/family-wallet/`**. Negli URI di reindirizzamento di Google e
Microsoft va messo l'indirizzo finale, quello che compare nella barra del browser.

### Google

Come Spendly: login a redirect, solo Client ID, nessuna chiave API.

1. [Google Cloud Console](https://console.cloud.google.com/): crea un progetto e abilita **Google Sheets API** e **Google Drive API**.
2. **Google Auth Platform** (schermata di consenso): pubblico *Esterno*; in *Accesso ai dati* aggiungi gli scope
   `openid`, `userinfo.email`, `userinfo.profile`, `.../auth/drive.file` e `.../auth/spreadsheets`.
   In *Pubblico* lascia l'app **in test** e aggiungi i familiari come **utenti di test**.
3. *Client* → **Crea client** → *Applicazione web*:
   - Origini JavaScript autorizzate: `https://<utente>.github.io` e `http://localhost:8080`
   - URI di reindirizzamento autorizzati: `https://<utente>.github.io/<repo>/` e `http://localhost:8080/`
4. Copia l'ID client → `clientId`.

`spreadsheets` serve per aprire il foglio di un altro con il codice del wallet. È uno scope "sensibile":
finché l'app non viene verificata da Google, al login compare *"Google non ha verificato questa app"*
(si prosegue con *Avanzate → Vai a Family Wallet*). Il token dura un'ora e l'app lo rinnova da sola con
un redirect silenzioso.

### Microsoft

1. [Microsoft Entra](https://entra.microsoft.com/) → Registrazioni app → Nuova registrazione, account "qualsiasi directory e account Microsoft personali".
2. Piattaforma **Applicazione a pagina singola (SPA)** con URI di reindirizzamento `https://<utente>.github.io/<repo>/` (e `http://localhost:8080/`).
3. Autorizzazioni delegate di Microsoft Graph: `User.Read`, `Files.ReadWrite.All`, `offline_access`.
4. L'ID applicazione (client) → `clientId`.

## Rilascio

A ogni push su `main` la GitHub Action [`deploy.yml`](.github/workflows/deploy.yml) esegue i test,
fa la build e pubblica su GitHub Pages (una volta sola: Settings → Pages → Source: **GitHub Actions**).

La build ([`scripts/build.mjs`](scripts/build.mjs), senza dipendenze) dà a JS e CSS un nome con l'hash
del contenuto (`app.02033dd649.js`) e riscrive gli import tra moduli; `index.html` punta ai nuovi nomi.
Dopo un rilascio basta un refresh per avere la versione nuova, e i file invariati restano in cache.
GitHub Pages tiene `index.html` in cache al massimo 10 minuti.

## Sviluppo

Serve solo Node.js (≥ 22):

```bash
npm start
```

apre il sorgente su http://localhost:8080;

```bash
npm run preview
```

fa la build e serve `dist/` come in produzione;

```bash
npm test
```

esegue i test (calcolo dei saldi e conversione documento ↔ foglio).
