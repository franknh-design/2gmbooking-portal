// functions/_utils/deposit.js
// v2.0 — Ren summering for depositum/manglende utstyr. INGEN I/O.
// Prisene er nå redigerbare og leses fra Deposit_Prices (se getDepositPrices i
// sharepoint.js); de injiseres som priceMap. Beløpet er server-autoritativt.

// De kjente vare-nøklene (brukes til validering/label-referanse i UI).
export const ITEM_KEYS = ["liten_handduk", "stor_handduk", "pute", "dyne", "sengesett"];

// items: string[] av vare-nøkler. priceMap: { <nøkkel>: <pris kr> } (fra SharePoint).
// En vare må ha en POSITIV pris i mappet, ellers avvises den (unknown_item).
// Returnerer { ok:true, amount } eller { ok:false, error, item? }.
export function sumMissingItems(items, priceMap) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "no_items" };
  }
  const map = priceMap || {};
  let amount = 0;
  for (const it of items) {
    const price = map[it];
    if (!(typeof price === "number" && price > 0)) {
      return { ok: false, error: "unknown_item", item: it };
    }
    amount += price;
  }
  return { ok: true, amount };
}
