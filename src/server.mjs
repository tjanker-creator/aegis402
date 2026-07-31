// A payment-gated x402 resource server (the merchant side).
//
//   npm run server
//
// GET /premium  -> 402 Payment Required with x402 payment requirements
//              -> pay, retry, receive the data
//
// This is a plain, unmodified x402 server: AEGIS402 changes nothing here.
// The guard lives on the PAYER side, inside the payment group. That is the
// point — an agent can protect itself without asking every merchant on the
// internet to cooperate.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { account, requirements, facilitatorFeePayer, facilitator } from "./common.mjs";
import "dotenv/config";

const PRICE_MICRO = Number(process.env.PRICE_MICRO ?? 10000); // 0.01 USDC
const merchant = account("MERCHANT").addr;
const feePayer = await facilitatorFeePayer();
const app = new Hono();

const b64json = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

app.get("/", (c) => c.json({
  service: "AEGIS402 demo merchant",
  endpoints: { "GET /premium": `${PRICE_MICRO} microUSDC via x402 on Algorand TestNet` },
}));

app.get("/premium", async (c) => {
  const reqs = requirements({ amount: PRICE_MICRO, payTo: merchant, feePayer });
  const signature = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");

  if (!signature) {
    c.header("PAYMENT-REQUIRED", b64json({
      x402Version: 2,
      error: "Payment required",
      resource: { url: "/premium", description: "AEGIS402 demo premium data", mimeType: "application/json" },
      accepts: [reqs],
    }));
    return c.json({ error: "payment required", accepts: [reqs] }, 402);
  }

  const paymentPayload = JSON.parse(Buffer.from(signature, "base64").toString("utf8"));
  const verify = await facilitator("/verify", paymentPayload, reqs);
  if (verify.body?.isValid !== true) {
    return c.json({ error: "payment invalid", reason: verify.body?.invalidReason ?? verify.body }, 402);
  }
  const settle = await facilitator("/settle", paymentPayload, reqs);
  if (settle.body?.success !== true) {
    return c.json({ error: "settlement failed", reason: settle.body?.errorReason ?? settle.body }, 402);
  }

  c.header("PAYMENT-RESPONSE", b64json(settle.body));
  return c.json({
    data: "premium payload delivered",
    paidWith: { txId: settle.body.transaction, network: "algorand-testnet" },
  });
});

const port = Number(process.env.PORT ?? 4021);
serve({ fetch: app.fetch, port });
console.log(`AEGIS402 demo merchant on http://localhost:${port}`);
console.log(`  payTo   ${merchant}`);
console.log(`  price   ${PRICE_MICRO} microUSDC`);
