// functions/_utils/providers-mock.js
// v1.0 — Mock betalings- og lås-providere for Fase 2. Ekte Vipps (Fase 4) og
// Yale/Tuya (Fase 5) implementerer samme grensesnitt. Mocken er deterministisk:
// betaling "initieres" som pending med en placeholder-ref; kode-generering
// lykkes og returnerer placeholder-koder.

export const mockPayment = {
  async initiate({ bookingRef }) {
    return { paymentRef: `MOCK-${bookingRef}`, status: "pending" };
  },
  async refund(_args) {
    return;
  },
};

export const mockLock = {
  async generateGuestCodes({ booking }) {
    // Deterministisk placeholder; ekte koder kommer i Fase 5.
    const suffix = String(booking.roomId || "0").padStart(4, "0").slice(-4);
    return { entranceCode: `1${suffix}`, roomCode: `2${suffix}` };
  },
};
