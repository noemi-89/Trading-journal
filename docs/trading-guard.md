# Trading Guard e Pattern Interrupt

## Obiettivo e confine

Trading Guard serve a interrompere il tilt con un gesto deliberato e difficile da annullare: il Journal mostra il pulsante rosso, il ponte Windows locale avvia Cold Turkey e Cold Turkey impedisce l'accesso a TradingView fino al cutoff della sessione NY.

Il sistema è intenzionalmente manuale. Non si collega a Tradovate o MFFU, non legge il conto, non rileva automaticamente le posizioni e non invia, modifica, cancella o liquida ordini. Non usa i trade salvati nel Journal e non scrive nel loro `localStorage`.

## Regole operative

Le tre regole sintetiche mostrate nel Journal sono:

```text
NY AM SESSION: 2 LOSS = STOP
NY PM SESSION: 2 LOSS = STOP
NY DAILY LIMIT: 3 LOSS = STOP
```

Definizioni consolidate:

- NY AM: dalle `09:30:00` incluse alle `12:00:00` escluse, ora `America/New_York`.
- NY PM: dalle `12:00:00` incluse alle `16:00:00` escluse, ora `America/New_York`.
- P&L: netto realizzato, commissioni incluse.
- BE: da `-$150` a `+$150`, estremi inclusi.
- Loss: strettamente inferiore a `-$150`; quindi `-$150,00` è BE e `-$150,01` è Loss.
- Win o BE non contano come Loss.
- Un trade è un position cycle completo, non un singolo fill. Con uscite parziali si somma l'intero P&L e si valuta solo quando la posizione è completamente chiusa.
- Seconda Loss NY AM: STOP fino alle `12:00 ET`.
- Seconda Loss NY PM oppure terza Loss giornaliera: STOP fino alle `16:00 ET`.

Il Journal non conta le Loss e non decide al posto dell'utente se una regola è scattata. Quando si preme STOP, il ponte sceglie AM o PM usando l'ora NY di quel momento. Fuori dalle due finestre, nei weekend o dalle `16:00 ET` in poi, la richiesta viene rifiutata senza attivare un blocco.

## Procedura manuale STOP

Sequenza obbligatoria:

```text
FLAT → CANCEL ALL → VERIFY → STOP → BIKE
```

1. Chiudere completamente la posizione.
2. Usare `Cancel All` nella piattaforma.
3. Verificare visivamente che la posizione sia `FLAT`.
4. Verificare visivamente che non esistano ordini pendenti.
5. Aprire il pulsante rosso `STOP`, disponibile sempre nel Journal o nella sezione `PATTERN INTERRUPT`.
6. Selezionare entrambe le conferme:
   - `CONFERMO: POSIZIONE FLAT`
   - `CONFERMO: NESSUN ORDINE PENDENTE`
7. Tenere premuto STOP per due secondi senza rilasciare. Il rilascio anticipato annulla tutto e non invia la richiesta.
8. Attendere la conferma verificata di Cold Turkey. Non interpretare il semplice invio della richiesta come successo.

Successo AM:

```text
TRADINGVIEW BLOCCATO FINO ALLE 12:00 ET
ALZATI E VAI SULLA BIKE.
```

Successo PM:

```text
TRADINGVIEW BLOCCATO FINO ALLE 16:00 ET
ALZATI E VAI SULLA BIKE.
```

Se appare `BLOCCO NON CONFERMATO — APRI COLD TURKEY ORA.`, il Journal non ha ricevuto una prova valida dello stato `Enabled`: verificare immediatamente Cold Turkey e non presumere che TradingView sia protetto.

Trading Guard non può controllare se le due conferme sono vere. Se per errore resta un ordine aperto dopo il blocco, il telefono è esclusivamente la via di emergenza per gestirlo; non è una seconda postazione di trading.

## Pattern interrupt fisico

Dopo la conferma del blocco:

1. alzarsi immediatamente dalla postazione;
2. salire sulla bike da spinning;
3. fare `10 MINUTI` di Bike Reset;
4. non restare davanti ai grafici e non cercare una scorciatoia al blocco.

Il passaggio fisico fa parte della procedura, non è un suggerimento opzionale: separa il momento della Loss dalla possibilità di compiere un'altra azione impulsiva.

## Componenti

### Journal

- Mostra le regole, il flusso e il pulsante STOP.
- Richiede le due conferme e una pressione continua di due secondi.
- Genera un UUID per rendere la richiesta ritentabile senza duplicare il comando.
- Chiama soltanto `POST http://127.0.0.1:48173/v1/stop`.
- Mostra successo soltanto se la risposta dichiara `Enabled`, la sessione AM/PM corretta e il messaggio/cutoff atteso.
- Non offre un pulsante OFF e non persiste stato Trading Guard nei dati del Journal.

### Trading Guard Local

Cartella separata:

```text
C:\Users\<utente>\Documents\New project\Trading-Guard-Local
```

- Ascolta esclusivamente su `127.0.0.1:48173`.
- Usa `America/New_York` come fonte temporale e gestisce automaticamente il DST.
- Sceglie il blocco AM o PM; il browser non può fornire nome blocco, durata o comando.
- Arrotonda per eccesso i minuti mancanti al cutoff, quindi il blocco non può terminare in anticipo.
- Serializza i comandi Cold Turkey.
- Considera un testo CLI `Error:` un fallimento anche quando l'exit code è `0`.
- Verifica ogni attivazione con `-status` e retry.
- Persiste soltanto lo stato tecnico necessario al cleanup e un registro JSONL in `%LOCALAPPDATA%\TradingGuard`.
- Dopo la scadenza del timer invia internamente `-stop` e verifica `Disabled`.
- Non espone alcun endpoint HTTP di unlock/off.

Endpoint di controllo non distruttivo:

```text
GET http://127.0.0.1:48173/v1/health
GET http://127.0.0.1:48173/v1/status
```

### Cold Turkey

Nomi esatti dei contenitori definitivi:

```text
TRADING GUARD AM SESSION
TRADING GUARD PM SESSION
```

Entrambi devono contenere soltanto:

- sito `tradingview.com`;
- applicazione `TradingView.exe`.

Per l'integrazione dinamica devono essere `At all times`/continui, `Off`, `Unlocked`, autostart `None`, breaks assenti e lock configurato `None`. Non devono restare blocchi settimanali con lock `Schedule`: il test ha dimostrato che quel lock impedisce alla CLI di eseguire `-stop` anche fuori dalla finestra.

Il ponte applica al momento dello STOP un lock Timer con la durata residua. Cold Turkey usa minuti interi: l'arrotondamento conservativo può far terminare la protezione fino a 59 secondi oltre `12:00` o `16:00`, più un breve margine di cleanup, mai prima.

Per usare la CLI, la finestra Cold Turkey deve essere chiusa con `X` e poi con `Exit` dall'icona nell'area di notifica. Il servizio di blocco continua a operare. Se l'interfaccia è ancora aperta, Trading Guard restituisce errore invece di dichiarare un falso successo.

## Ora legale e orari italiani

Gli orari italiani non sono la fonte di verità. Il ponte converte ogni richiesta con il database di fuso orario `America/New_York`, quindi segue automaticamente EST/EDT.

Questo evita l'errore delle settimane in cui Stati Uniti ed Europa cambiano l'ora in date diverse. In quelle settimane le sessioni NY si spostano di un'ora rispetto all'orologio italiano senza richiedere modifiche alla configurazione.

## Avvio e controllo salute

Cold Turkey e il ponte sono due processi distinti. Per il funzionamento del pulsante:

1. il servizio Cold Turkey deve essere installato e operativo;
2. l'interfaccia Cold Turkey deve essere chiusa davvero con tray `Exit`;
3. `TradingGuard.Helper.ps1` deve essere in esecuzione prima della sessione;
4. `GET /v1/health` deve rispondere `ok: true`, `ready: true` e `code: "ready"`.

Avvio manuale:

```powershell
& ".\Start-TradingGuard.ps1"
```

Controllo salute, che non esegue alcun comando Cold Turkey:

```powershell
Invoke-RestMethod http://127.0.0.1:48173/v1/health
```

Messaggio atteso nella finestra del ponte:

```text
Trading Guard Local is listening at http://127.0.0.1:48173/v1/health
```

L'avvio automatico per-user si installa con `Install-TradingGuardStartup.ps1`: crea un solo collegamento nella cartella Startup, avvia il ponte nascosto e ne verifica la salute. Non richiede privilegi amministrativi. Se il ponte viene chiuso mentre un timer è attivo, Cold Turkey continua a proteggere; il cleanup viene recuperato al riavvio del ponte. Il comportamento di emergenza è conservativo: un guasto può prolungare il blocco, non anticiparne la fine.

## Confini di sicurezza loopback

- Il server usa `TcpListener` su IPv4 loopback, senza URLACL o privilegi amministrativi.
- Rifiuta client non-loopback e header `Host` diversi da `127.0.0.1:48173`/`localhost:48173`.
- `POST /stop` senza `Origin` viene rifiutato.
- La allowlist CORS contiene l'origine GitHub Pages del Journal e origini locali di sviluppo esplicite; non usa `*`.
- JSON e header `X-Trading-Guard-Intent` obbligano il browser al preflight.
- Il preflight conserva compatibilità con Private Network Access. Su Chrome 142+ il Journal pubblico può mostrare una sola volta il permesso Local Network Access: va consentito perché il sito deve raggiungere esclusivamente il ponte su `127.0.0.1`.
- Conferme FLAT/ordini, idempotenza, serializzazione e rate limit sono verificati lato ponte.
- Non esistono endpoint per passare un comando, un eseguibile, il nome del blocco, una durata arbitraria o una richiesta di unlock.
- Nessuna password, API key o credenziale viene salvata nel repository.

## Procedura di test sicura

### 1. Test automatici senza Cold Turkey reale

Da `Trading-Guard-Local`:

```powershell
& ".\tests\Run-Tests.ps1"
```

Esito atteso:

```text
PASS: 101 assertions
```

La suite usa una CLI fittizia e una directory temporanea; non apre Cold Turkey e non può bloccare TradingView.

### 2. Collaudo nativo su UpNote

Usare il solo blocco `PROVA`, mai i due blocchi TradingView:

1. contenuto: soltanto UpNote;
2. tipo: continuo / `At all times`;
3. lock configurato: `None`;
4. autostart: `None`;
5. toggle: `Off`, stato `Unlocked`;
6. chiudere Cold Turkey con `X`, poi tray `Exit`;
7. avviare `PROVA` con un timer CLI breve;
8. verificare che UpNote non si apra;
9. provare `-stop` durante il timer: deve essere rifiutato;
10. dopo la scadenza, eseguire `-stop` e verificare `Disabled` e riapertura di UpNote.

Questo collaudo dimostra timer, resistenza allo stop anticipato e riapertura. Non dimostra ancora il collegamento browser HTTPS → loopback, che va verificato separatamente dal Journal con il ponte attivo.

### 3. Controllo browser → ponte

Con il ponte attivo, aprire il Journal in Chrome e verificare che il browser consenta la rete locale quando richiesto. Il solo `GET /health` è non mutante. Il pulsante rosso invece attiva realmente il blocco pertinente: non usarlo come test casuale.

### 4. Unico test reale TradingView

Eseguirlo soltanto senza operatività:

```text
POSIZIONE FLAT
NESSUN ORDINE PENDENTE
NESSUN TRADE DA ESEGUIRE FINO AL CUTOFF
ACCESSO TELEFONO DISPONIBILE SOLO PER EMERGENZA
```

Poi premere STOP, verificare sia `tradingview.com` sia `TradingView.exe`, attendere il cutoff e confermare che il cleanup riporti il blocco su `Disabled`. Se una sola verifica fallisce, non considerare concluso il collaudo e usare Cold Turkey manualmente.
