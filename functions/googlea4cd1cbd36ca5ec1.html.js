// Google Search Console-verifisering for https://www.2gm.no/ (09.10.2026).
// Må ligge her så lenge eierskapet skal være bekreftet — ikke slett.
// Function i stedet for statisk fil: Pages 308-redirecter /x.html → /x, og
// Google krever at fila svarer direkte på nøyaktig denne URL-en.
export function onRequest() {
  return new Response("google-site-verification: googlea4cd1cbd36ca5ec1.html", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
