// functions/_utils/sharepoint.js
// v1.0 - SharePoint operations via Microsoft Graph

import { graphRequest } from "./graph.js";

// SharePoint site ID - hardkodet siden den er konstant
// Fra PowerShell: Get-MgSite -SiteId "2gmeiendom.sharepoint.com:/sites/2GMBooking"
const SITE_ID = "2gmeiendom.sharepoint.com,ccff273d-0332-4541-bdaa-7ab2acb35882,b3801ad9-27fc-4b55-8fa4-c1113315c376";
const TOKENS_LIST = "Customer_Tokens";

/**
 * Slår opp en token i Customer_Tokens-listen.
 * Returnerer raden hvis funnet og aktiv, ellers null.
 */
export async function findToken(env, token) {
  // Hent alle aktive tokens. SharePoint har grense på 5000 items per kall,
  // men vi forventer ~200 kunder maks - ingen behov for paginering ennå.
  const path = `/sites/${SITE_ID}/lists/${TOKENS_LIST}/items?expand=fields&$top=999`;
  
  const data = await graphRequest(env, path);
  
  const match = data.value.find(item => 
    item.fields.Token === token && item.fields.Aktiv === true
  );

  if (!match) return null;

  // Sjekk utløpsdato (hvis satt)
  if (match.fields.Utlopsdato) {
    const expiry = new Date(match.fields.Utlopsdato);
    if (expiry < new Date()) {
      return null; // Utløpt
    }
  }

  return {
    id: match.id,
    fields: match.fields,
  };
}

/**
 * Oppdaterer SistBrukt og inkrementerer AntallBestillinger på en token-rad.
 * Brukes etter vellykket validering for sporing.
 */
export async function logTokenUsage(env, itemId, currentCount) {
  const path = `/sites/${SITE_ID}/lists/${TOKENS_LIST}/items/${itemId}/fields`;
  
  await graphRequest(env, path, {
    method: "PATCH",
    body: JSON.stringify({
      SistBrukt: new Date().toISOString(),
      AntallBestillinger: (currentCount || 0) + 1,
    }),
  });
}

/**
 * Maskerer telefonnummer for visning. +4791234567 → +47 ••• •• 567
 */
export function maskPhone(phone) {
  if (!phone || phone.length < 4) return "";
  const last3 = phone.slice(-3);
  return `+47 ••• •• ${last3}`;
}
