// functions/api/stripe-webhook.js
// v1.0 — Stripe webhook. checkout.session.completed → lagre kort-id-er →
// confirmPayment → bekreftelses-e-post. Signatur verifiseres mot STRIPE_WEBHOOK_SECRET.
import { verifyWebhookSignature, retrievePaymentIntent } from "../_utils/stripe.js";
import { createSharePointStore } from "../_utils/booking-store.js";
import { mockLock } from "../_utils/providers-mock.js";
import { confirmPayment } from "../_utils/booking-orchestrator.js";
import { sendEmail } from "../_utils/email.js";
import { upsertPersonForBooking } from "../_utils/sharepoint.js";

const PROPERTY_NAME = "Rigg Andslimoen";

export async function onRequestPost(context) {
  const { request, env } = context;
  const raw = await request.text(); // RÅ body kreves for signatur
  const sig = request.headers.get("stripe-signature");
  const ok = await verifyWebhookSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  if (!ok) return new Response("bad signature", { status: 400 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  if (event.type !== "checkout.session.completed") {
    return new Response("ignored", { status: 200 });
  }

  try {
    const session = event.data.object;
    const bookingRef = session.metadata && session.metadata.bookingRef;
    if (!bookingRef) return new Response("no ref", { status: 200 });

    const store = createSharePointStore(env, PROPERTY_NAME);
    const all = await store.getBookings();
    const row = all.find((b) => b.bookingRef === bookingRef);
    if (!row) return new Response("unknown booking", { status: 200 });

    let paymentMethodId = null;
    try {
      const pi = await retrievePaymentIntent(env, session.payment_intent);
      paymentMethodId = pi.payment_method || null;
    } catch (e) { console.error("[webhook] retrieve PI feilet:", e); }
    await store.update(row.id, {
      stripeCustomerId: session.customer || null,
      stripePaymentMethodId: paymentMethodId,
      paymentRef: session.payment_intent || row.paymentRef,
    });

    const deps = { store, lock: mockLock, now: () => Date.now() };
    await confirmPayment(deps, bookingRef);

    try {
      const fresh = (await store.getBookings()).find((b) => b.bookingRef === bookingRef) || row;
      if (fresh.guestEmail) {
        const subject = `Booking bekreftet ${bookingRef} — Rigg Andslimoen`;
        const text = `Hei,\n\nBetalingen er mottatt og bookingen din på Rigg Andslimoen er bekreftet.\n\nReferanse: ${bookingRef}\n\nTilgangskoder kommer før innsjekk.\n\nVennlig hilsen\n2GM Eiendom`;
        await sendEmail(env, { to: fresh.guestEmail, subject, text });
      }
      // Legg privat-gjesten i gjestelista (Persons) — bekreftet booking, tom
      // Company = privat, GuestType=Privat. Best-effort (gjenbruker `fresh`).
      if (fresh.guestName) {
        await upsertPersonForBooking(env, {
          name: fresh.guestName,
          phone: fresh.guestPhone || null,
          email: fresh.guestEmail || null,
          company: "",
          guestType: "Privat",
        });
      }
    } catch (e) { console.error("[webhook] bekreftelses-e-post / Persons-upsert feilet (ignorert):", e); }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return new Response("error", { status: 500 });
  }
}
