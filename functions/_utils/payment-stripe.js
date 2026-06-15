// functions/_utils/payment-stripe.js
// v1.0 — Ekte Stripe-provider bak Fase 2-betalingsabstraksjonen. initiate()
// oppretter en Checkout Session og returnerer { paymentRef, checkoutUrl }.
// Lukker over env + URL-er via createStripePayment(env, baseUrl).
import { createCheckoutSession, chargeSavedCard as stripeCharge, refund as stripeRefund } from "./stripe.js";

export function createStripePayment(env, baseUrl) {
  return {
    async initiate({ bookingRef, amount, email, productName }) {
      const session = await createCheckoutSession(env, {
        bookingRef,
        amountKr: amount,
        productName: productName || `Rigg Andslimoen (${bookingRef})`,
        email: email || undefined,
        successUrl: `${baseUrl}/andslimoen?ok=${encodeURIComponent(bookingRef)}`,
        cancelUrl: `${baseUrl}/andslimoen?avbrutt=1`,
      });
      return { paymentRef: session.id, checkoutUrl: session.url, status: "pending" };
    },
    async refund({ paymentRef, amountKr }) {
      // paymentRef her er Checkout Session-id i hold-fasen; refusjon krever
      // PaymentIntent-id. Avbestilling håndteres manuelt i v1 (Stripe-dashboard),
      // så denne brukes først når selvbetjent avbestilling bygges. No-op-trygg.
      if (!paymentRef) return;
      return stripeRefund(env, { paymentIntentId: paymentRef, amountKr });
    },
    async chargeSavedCard(args) {
      return stripeCharge(env, args);
    },
  };
}
