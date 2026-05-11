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
