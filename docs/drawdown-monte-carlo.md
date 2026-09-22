# Drawdown e Monte Carlo

## Audit di partenza

Il backup piu recente disponibile durante lo sviluppo era
`hello-noemi-journal-backup-2026-09-10-1214.json`.

- 117 trade chiusi o classificati nel journal
- 39 giornate di trading, dal 2 giugno all'8 settembre 2026
- 0 ID trade duplicati
- 46 righe marcate come partial
- 15 ES, 38 MES, 19 NQ e 45 MNQ

Il backup e stato letto soltanto per verificare la struttura del campione. Nessun
dato del browser o del file di backup e stato modificato.

## Drawdown

La Dashboard apre sulla vista `DRAWDOWN`. Per ogni trade chiuso, ordinato per
data e ora, il drawdown e:

```text
running peak - cumulative R
```

La vista `EQUITY` resta disponibile nello stesso pannello. I cumulati conservano
la precisione completa e vengono arrotondati soltanto in visualizzazione.

`PROP LIMIT` aggiunge una soglia configurabile in R. La soglia viene salvata in
`jnl:v2:settings` con:

- `propLimitEnabled`
- `propDrawdownLimitR`

Disattivando il toggle il journal passa alla modalita `CONTO PERSONALE` e non
mostra ne usa la soglia prop. La soglia rappresenta un limite peak-to-trough
indicativo: non replica automaticamente regole trailing, daily loss o altre
condizioni specifiche di una prop firm.

## Monte Carlo

La sezione usa un bootstrap per giornata con rimpiazzo. Tutti i trade e le
uscite parziali della stessa data restano nello stesso blocco e nella loro
sequenza cronologica; in questo modo non vengono trattati come eventi
indipendenti. Il fan chart usa il risultato a fine giornata, mentre massimo
drawdown e superamento del limite prop vengono verificati dopo ogni trade
interno al blocco. I BE mantengono il loro P&L reale.
La conversione in R usa il valore globale `1R` attivo nel journal, come le
metriche della Dashboard.

Parametri UI:

- 10.000 percorsi
- orizzonte 20, 50, 100 giornate oppure campione storico corrente
- seed deterministico iniziale e pulsante per una nuova estrazione

Output principali:

- fan chart P5-P95, P25-P75 e mediana
- outcome mediano e P5
- probabilita di chiudere sopra zero
- distribuzione e percentili del massimo drawdown
- probabilita di superare la soglia prop, solo quando attiva
- streak di giornate negative e tempo massimo sotto il precedente picco

La simulazione descrive la variabilita del campione registrato. Non e una
previsione dei risultati futuri e non simula le regole contrattuali complete di
una prop firm.
