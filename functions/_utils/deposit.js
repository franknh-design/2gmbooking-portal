// functions/_utils/deposit.js
// v1.0 — Ren prisliste + summering for depositum/manglende utstyr. INGEN I/O.
// Belastes off-session på det lagrede kortet (se charge-missing-items).

export const PRICE_LIST = {
  liten_handduk: 100,
  stor_handduk: 150,
  pute: 400,
  dyne: 700,
  sengesett: 400,
};

// Maks som kan belastes (alt borte) — oppgis i vilkårene.
export const MAX_DEPOSIT = 1750;

// items: string[] av nøkler fra PRICE_LIST. Returnerer { ok, amount } eller { ok:false, error }.
export function sumMissingItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "no_items" };
  }
  let amount = 0;
  for (const it of items) {
    const price = PRICE_LIST[it];
    if (price == null) return { ok: false, error: "unknown_item", item: it };
    amount += price;
  }
  if (amount > MAX_DEPOSIT) amount = MAX_DEPOSIT;
  return { ok: true, amount };
}
