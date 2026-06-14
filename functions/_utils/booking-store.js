// functions/_utils/booking-store.js
// v1.0 — SharePoint-basert store for privat-bookingflyten. Mapper mellom SP-felt
// og den normaliserte booking/rom-shapen orkestratoren bruker. Tynn — ingen
// forretningslogikk. Door_Code-tilstedeværelse <=> codesGenerated.

import {
  getPropertyMetaMap,
  getRoomsForProperty,
  getBookingsForProperty,
  createPublicHoldRow,
  updateBookingFields,
} from "./sharepoint.js";
import { parseDateUtcMs } from "./availability-math.js";

function msToISODateTime(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}

// Mapper en normalisert patch til SP-feltnavn.
function patchToSpFields(patch) {
  const sp = {};
  if ("status" in patch) sp.Status = patch.status;
  if ("paymentStatus" in patch) sp.PaymentStatus = patch.paymentStatus;
  if ("paidAtMs" in patch) sp.PaidAt = msToISODateTime(patch.paidAtMs);
  if ("paymentRef" in patch) sp.PaymentRef = patch.paymentRef;
  if ("roomId" in patch) sp.RoomLookupId = patch.roomId;
  if ("codesGenerated" in patch && patch.codesGenerated) {
    sp.Door_Code = patch.roomCode != null ? String(patch.roomCode) : "GENERATED";
  }
  return sp;
}

export function createSharePointStore(env, propertyName) {
  return {
    async getRooms() {
      const meta = await getPropertyMetaMap(env);
      const propertyMap = {};
      for (const [id, m] of Object.entries(meta)) if (m.title) propertyMap[id] = m.title;
      const items = await getRoomsForProperty(env, propertyName, propertyMap);
      return items.map((it) => {
        const f = it.fields || {};
        return {
          id: String(it.id),
          publicBookable: f.PublicBookable !== false,
          longTermStartMs: parseDateUtcMs(f.LongTerm_StartDate),
          longTermEndMs: parseDateUtcMs(f.LongTerm_EndDate),
        };
      });
    },

    async getBookings() {
      const items = await getBookingsForProperty(env, propertyName);
      return items.map((it) => {
        const f = it.fields || {};
        return {
          id: String(it.id),
          bookingRef: f.Title || "",
          roomId: f.RoomLookupId != null ? String(f.RoomLookupId) : null,
          checkInMs: parseDateUtcMs(f.Check_In),
          checkOutMs: parseDateUtcMs(f.Check_Out),
          status: f.Status || "",
          paymentStatus: f.PaymentStatus || "pending",
          holdExpiryMs: parseDateUtcMs(f.HoldExpiry),
          paidAtMs: parseDateUtcMs(f.PaidAt),
          codesGenerated: !!(f.Door_Code && String(f.Door_Code).trim()),
          source: f.Source || "",
        };
      });
    },

    async createHold({ bookingRef, roomId, checkInISO, checkOutISO, guest, holdExpiryMs, paymentRef }) {
      const res = await createPublicHoldRow(env, {
        bookingRef,
        propertyName,
        guestName: guest.name,
        guestPhone: guest.phone || null,
        guestEmail: guest.email || null,
        checkIn: checkInISO,
        checkOut: checkOutISO || null,
        roomId,
        holdExpiryISO: msToISODateTime(holdExpiryMs),
        paymentRef: paymentRef || null,
      });
      return { id: res && res.id ? String(res.id) : null, bookingRef };
    },

    async update(id, patch) {
      await updateBookingFields(env, id, patchToSpFields(patch));
    },
  };
}
