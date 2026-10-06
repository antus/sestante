/**
 * Le aree dei requisiti, condivise da requisiti-github.mjs e requisiti-project.mjs.
 * Per ciascuna: etichetta breve (le etichette GitHub hanno al massimo 50 caratteri) e colore.
 * L'ordine è quello del modulo .github/ISSUE_TEMPLATE/requisito.yml.
 */
export const AREE = {
  "Cartografia e prima impressione": ["area: cartografia", "1f6feb"],
  "Il guscio dell'interfaccia": ["area: interfaccia", "8250df"],
  "Tenancy, condivisione e collaborazione": ["area: condivisione", "bf3989"],
  "Piani, diritti d'uso e marketplace": ["area: piani e marketplace", "a40e26"],
  "Dati: ingestione, sorgenti e scala": ["area: dati", "0969da"],
  "Analisi: dal browser al processo governato": ["area: analisi", "1a7f37"],
  "Editing dei dati e lavoro sul campo": ["area: editing e campo", "9a6700"],
  "Monitoraggio, allerte e gemelli digitali": ["area: monitoraggio", "bc4c00"],
  "AI: assistente, modelli e prodotti di rischio": ["area: ai", "6639ba"],
  "Artefatti che escono dalla piattaforma": ["area: artefatti", "57606a"],
  "Interoperabilità: catalogo, map server e desktop": ["area: interoperabilità", "0550ae"],
  "Ecosistema: API, SDK e sistema dei plugin": ["area: ecosistema", "116329"],
  "Contenuti e dimostrabilità": ["area: contenuti", "7d4e00"],
  "Fondamenta tecniche: deploy, qualità e test": ["area: fondamenta", "24292f"],
  "Modelli BIM: il costruito dentro il territorio": ["area: bim", "953800"],
  "La superficie pubblica: contenuti e catalogo aperto": ["area: superficie pubblica", "3192aa"],
  "Conformità alle regole della pubblica amministrazione": ["area: conformità PA", "cf222e"],
};
export const AREE_ELENCO = Object.keys(AREE);
