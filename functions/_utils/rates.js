// functions/_utils/rates.js
// v1.0 (portal v3.10.4) — pris-oppslag for fakturaarkivet.
//
// Portet fra admin-appens js/rates.js. Speiler nightly-rate-hierarkiet:
//   1) Person + Property (fuzzy navne-match, eksakt eiendom)
//   2) Person (any property)
//   3) Company + Property
//   4) Company (any property)
//   5) Room.DailyRate
//   6) Property.DailyRate
//
// VAT, checkout-gebyr og percent-fees er IKKE inkludert — portalen viser
// bare nights × rate = beløp før gebyrer/mva, slik at kunden ser den
// grunnleggende sammenhengen mellom opphold og kostnad. Den endelige
// fakturaen kan avvike pga. gebyrer og avtalte justeringer.

function nameMatch(a, b) {
  const la = String(a || "").toLowerCase().trim();
  const lb = String(b || "").toLowerCase().trim();
  if (!la || !lb) return false;
  if (la === lb) return true;
  const wa = la.split(/[\s,]+/).filter(w => w.length > 1);
  const wb = lb.split(/[\s,]+/).filter(w => w.length > 1);
  if (wa.length < 2 || wb.length < 2) return false;
  return wa.every(w => lb.indexOf(w) >= 0) || wb.every(w => la.indexOf(w) >= 0);
}

function isNightlyRate(r) {
  return String(r.FeeType || "").toLowerCase() !== "checkout"
      && String(r.FeeType || "").toLowerCase() !== "percent";
}

export function getDailyRate({ personName, company, propertyTitle, roomId, allRates, roomsById, propertiesById }) {
  const pt = String(propertyTitle || "").toLowerCase().trim();
  const co = String(company || "").toLowerCase().trim();

  // 1. Person + Property
  let r = allRates.find(x => isNightlyRate(x) && nameMatch(x.Person_Name, personName)
    && String(x.Property || "").toLowerCase() === pt && Number(x.DailyRate));
  if (r) return { rate: Number(r.DailyRate), source: "Person+Property" };

  // 2. Person any property
  r = allRates.find(x => isNightlyRate(x) && nameMatch(x.Person_Name, personName)
    && !x.Property && Number(x.DailyRate));
  if (r) return { rate: Number(r.DailyRate), source: "Person" };

  // 3. Company + Property
  if (co) {
    r = allRates.find(x => isNightlyRate(x)
      && String(x.Company || "").toLowerCase() === co
      && String(x.Property || "").toLowerCase() === pt
      && Number(x.DailyRate));
    if (r) return { rate: Number(r.DailyRate), source: "Company+Property" };
  }

  // 4. Company any property
  if (co) {
    r = allRates.find(x => isNightlyRate(x)
      && String(x.Company || "").toLowerCase() === co
      && !x.Property && Number(x.DailyRate));
    if (r) return { rate: Number(r.DailyRate), source: "Company" };
  }

  // 5. Room rate
  if (roomId && roomsById && roomsById[roomId] && roomsById[roomId].dailyRate) {
    return { rate: roomsById[roomId].dailyRate, source: "Room" };
  }

  // 6. Property default
  if (propertiesById) {
    const propEntry = Object.values(propertiesById).find(p => String(p.title || "").toLowerCase() === pt);
    if (propEntry && propEntry.dailyRate) {
      return { rate: propEntry.dailyRate, source: "Property" };
    }
  }

  return { rate: 0, source: "No rate set" };
}

// 3-tier oppslag for et gebyr av gitt FeeType. Brukt for både 'checkout'
// (normalt utvask-gebyr) og 'checkout1rabatt' (1-natt-rabatt). Beløpet ligger
// i DailyRate-kolonnen. Prioritet: 1) Firma+Eiendom  2) Firma  3) Eiendom-default.
// Returnerer { fee, source }; { fee: 0 } hvis ingen rad finnes.
function lookupFeeByType(feeType, company, propertyTitle, allRates) {
  const pt = String(propertyTitle || "").toLowerCase().trim();
  const co = String(company || "").toLowerCase().trim();
  const ft = String(feeType || "").toLowerCase();
  const feeRates = (allRates || []).filter(
    r => String(r.FeeType || "").toLowerCase() === ft && Number(r.DailyRate),
  );
  if (!feeRates.length) return { fee: 0, source: "No fee" };

  // 1. Firma + eiendom
  if (co) {
    const r = feeRates.find(rt =>
      String(rt.Company || "").toLowerCase() === co
      && String(rt.Property || "").toLowerCase() === pt);
    if (r) return { fee: Number(r.DailyRate) || 0, source: "Company+Property" };
  }
  // 2. Firma (uten eiendom)
  if (co) {
    const r = feeRates.find(rt =>
      String(rt.Company || "").toLowerCase() === co && !rt.Property);
    if (r) return { fee: Number(r.DailyRate) || 0, source: "Company" };
  }
  // 3. Eiendom-default (uten firma)
  const propRate = feeRates.find(rt =>
    String(rt.Property || "").toLowerCase() === pt && !rt.Company);
  if (propRate) return { fee: Number(propRate.DailyRate) || 0, source: "Property" };

  return { fee: 0, source: "No fee" };
}

// Utsjekks-/utvask-gebyr — Rates-rader med FeeType='checkout'. Beløpet ligger
// i DailyRate-kolonnen, som for nattrater. Speiler admin-appens getCheckoutFee
// (js/rates.js): 1) Firma+Eiendom  2) Firma  3) Eiendom-default  4) 0.
// Eiendom-default-nivået er viktig — utvask-gebyret er typisk satt pr. RIGG,
// ikke pr. firma. Returnerer { fee: 0 } hvis ingen rad finnes.
// nights: ved nøyaktig 1 natt trekkes en fast rabatt (FeeType='checkout1rabatt',
// samme 3-tier-oppslag), gulvet på 0. nights undefined/≥2/0 ⇒ normalt gebyr.
export function getCheckoutFee({ company, propertyTitle, allRates, nights }) {
  const normal = lookupFeeByType("checkout", company, propertyTitle, allRates);
  if (nights === 1) {
    const discount = lookupFeeByType("checkout1rabatt", company, propertyTitle, allRates);
    return { fee: Math.max(0, normal.fee - discount.fee), source: normal.source };
  }
  return { fee: normal.fee, source: normal.source };
}
