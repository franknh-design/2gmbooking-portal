import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSessionForm, verifyWebhookSignature, _hmacHex } from "../functions/_utils/stripe.js";

test("buildSessionForm encodes the required Checkout fields", () => {
  const form = buildSessionForm({
    bookingRef: "2GM-ABC123",
    amountKr: 1300,
    productName: "Rigg Andslimoen — 2 netter",
    email: "ola@example.no",
    successUrl: "https://x.dev/andslimoen?ok=2GM-ABC123",
    cancelUrl: "https://x.dev/andslimoen?avbrutt=1",
  });
  const s = form.toString();
  assert.match(s, /mode=payment/);
  assert.match(s, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=130000/);
  assert.match(s, /line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=nok/);
  assert.match(s, /payment_intent_data%5Bsetup_future_usage%5D=off_session/);
  assert.match(s, /metadata%5BbookingRef%5D=2GM-ABC123/);
  assert.match(s, /customer_email=ola%40example.no/);
});

test("buildSessionForm omits customer_email when not given", () => {
  const s = buildSessionForm({ bookingRef: "R", amountKr: 650, productName: "x", successUrl: "a", cancelUrl: "b" }).toString();
  assert.ok(!s.includes("customer_email"));
});

test("verifyWebhookSignature accepts a correctly signed payload", async () => {
  const secret = "whsec_test";
  const body = '{"hello":"world"}';
  const t = 1750000000;
  const sig = await _hmacHex(secret, `${t}.${body}`);
  const header = `t=${t},v1=${sig}`;
  assert.equal(await verifyWebhookSignature(body, header, secret, t + 10), true);
});

test("verifyWebhookSignature rejects bad signature / stale timestamp / garbage", async () => {
  const secret = "whsec_test";
  const body = '{"hello":"world"}';
  const t = 1750000000;
  const sig = await _hmacHex(secret, `${t}.${body}`);
  assert.equal(await verifyWebhookSignature(body, `t=${t},v1=deadbeef`, secret, t + 10), false);
  assert.equal(await verifyWebhookSignature(body, `t=${t},v1=${sig}`, secret, t + 10000), false);
  assert.equal(await verifyWebhookSignature(body, "garbage", secret, t), false);
});
