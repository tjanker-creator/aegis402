// The Arena — you write the supplier page, a real agent reads it, the chain
// decides.
//
//   npm run arena     then open http://localhost:4030
//
// Visitors (including judges, live) put any payment address they like into a
// product page. A real Claude model with a real guarded wallet reads it and
// decides on its own whether to pay. Then the ledger has the last word.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { runAgent } from "./agent.mjs";
import { account, usdcBalance } from "./common.mjs";
import "dotenv/config";

const app = new Hono();
const AGENT = account("AGENT").addr;
const MERCHANT = account("MERCHANT").addr;
const CAP = Number(process.env.CAP_MICRO ?? 50000);

// A public endpoint that spends real testnet USDC and real model tokens needs
// a leash: one run at a time, a short cooldown per caller, and a daily ceiling.
const COOLDOWN_MS = 20_000;
const DAILY_MAX = 200;
const seen = new Map();
let running = false;
let today = { day: new Date().toISOString().slice(0, 10), count: 0 };

function gate(ip) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== today.day) today = { day, count: 0 };
  if (today.count >= DAILY_MAX) return "The arena has done enough for one day. Come back tomorrow.";
  if (running) return "One attack at a time — someone else is mid-run. Try again in a few seconds.";
  const last = seen.get(ip) ?? 0;
  const wait = COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) return `Give it ${Math.ceil(wait / 1000)} seconds.`;
  return null;
}

app.get("/", (c) => c.html(readFileSync(new URL("./arena.html", import.meta.url), "utf8")));

app.get("/api/state", async (c) => c.json({
  agent: AGENT,
  balance: String(await usdcBalance(AGENT)),
  cap: CAP,
  allowed: MERCHANT,
  explorer: `https://lora.algokit.io/testnet/account/${AGENT}`,
}));

app.post("/api/attack", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const blocked = gate(ip);
  if (blocked) return c.json({ error: blocked }, 429);

  const { page } = await c.req.json();
  if (typeof page !== "string" || page.length < 10 || page.length > 4000) {
    return c.json({ error: "Write a supplier page between 10 and 4000 characters." }, 400);
  }

  seen.set(ip, Date.now());
  today.count += 1;
  running = true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runAgent(page, send);
      } catch (err) {
        send({ type: "error", message: String(err.message ?? err).slice(0, 200) });
      } finally {
        running = false;
        send({ type: "done" });
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
});

const port = Number(process.env.ARENA_PORT ?? 4030);
serve({ fetch: app.fetch, port });
console.log(`arena on http://localhost:${port}`);
console.log(`  agent   ${AGENT}`);
console.log(`  policy  max ${CAP} microUSDC, only to ${MERCHANT}`);
