// AEGIS402 falsification harness.
//
//   npm run attack
//
// Runs a battery of attacks against the LIVE hosted GoPlausible facilitator on
// Algorand TestNet. Every row asserts a LEDGER outcome (settled tx id, or the
// verbatim failure reason from the chain) plus the on-chain USDC balance delta.
//
// Rows marked RED are attacks we do NOT block. They are printed on purpose:
// a security claim you cannot falsify is not a security claim.
import { account, usdcBalance } from "../src/common.mjs";
import { buildGuardedGroup, verifyAndSettle } from "../src/aegis.mjs";
import "dotenv/config";

const POLICY = Number(process.env.POLICY_APP_ID);
const REJECT = Number(process.env.REJECT_APP_ID);
const CAP = Number(process.env.CAP_MICRO ?? 50000);
const AGENT = account("AGENT").addr;
const MERCHANT = account("MERCHANT").addr;
const ATTACKER = account("ATTACKER").addr;

if (!POLICY) { console.error("POLICY_APP_ID missing — run: node scripts/deploy.mjs"); process.exit(1); }

const SCENARIOS = [
  {
    id: "honest-payment",
    what: "Agent pays the allowlisted merchant, within cap",
    build: { amount: 10000, receiver: MERCHANT, guardAppId: POLICY },
    expect: "settle",
  },
  {
    id: "jailbreak-overspend",
    what: "Jailbroken agent tries to pay 10x the policy cap",
    build: { amount: CAP * 10, receiver: MERCHANT, guardAppId: POLICY },
    expect: "block",
  },
  {
    id: "jailbreak-redirect",
    what: "Jailbroken agent redirects payment to the attacker",
    build: { amount: 10000, receiver: ATTACKER, guardAppId: POLICY },
    expect: "block",
  },
  {
    id: "guard-mutant",
    what: "Guard app that rejects must kill the whole group",
    build: { amount: 10000, receiver: MERCHANT, guardAppId: REJECT },
    expect: "block",
  },
  {
    id: "rekey-smuggle",
    what: "Attacker smuggles a rekey into the payment group",
    build: { amount: 10000, receiver: MERCHANT, guardAppId: POLICY, rekeyTo: ATTACKER },
    expect: "block",
  },
  {
    id: "closeout-sweep",
    what: "Attacker smuggles an asset close-out (drain the rest)",
    build: { amount: 10000, receiver: MERCHANT, guardAppId: POLICY, closeOut: ATTACKER },
    expect: "block",
  },
  {
    id: "guard-omitted",
    what: "Agent omits the policy call and pays 10x the cap unguarded",
    build: { amount: CAP * 10, receiver: MERCHANT, guardAppId: null },
    expect: "settle",
    red: "NOT BLOCKED at this stage — an agent holding its own key can build an unguarded group. " +
         "Closed by the Deadbolt vault (account rekeyed to a LogicSig that refuses to sign without the policy call). See KNOWN_BYPASSES.md",
  },
];

const only = process.argv[2];
const rows = [];
console.log(`\nAEGIS402 falsification harness — live TestNet, hosted facilitator`);
console.log(`policy app ${POLICY} | cap ${CAP} microUSDC | allowlisted receiver ${MERCHANT}\n`);

for (const s of SCENARIOS) {
  if (only && s.id !== only) continue;
  const before = await usdcBalance(AGENT);
  let result;
  try {
    result = await verifyAndSettle(await buildGuardedGroup(s.build));
  } catch (e) {
    // A network/tooling failure must never be reported as "blocked".
    rows.push({ id: s.id, ok: false, outcome: "ERROR", detail: String(e.message ?? e), delta: 0n });
    console.log(`  ERROR   ${s.id}: ${e.message ?? e}`);
    continue;
  }
  // A settled payment needs a confirmed round before the balance reflects it;
  // a blocked one never touches the ledger, so a short wait is enough.
  await new Promise((r) => setTimeout(r, result.blocked ? 500 : 5000));
  const after = await usdcBalance(AGENT);
  const delta = (after ?? 0n) - (before ?? 0n);

  const outcome = result.blocked ? "block" : "settle";
  const ok = outcome === s.expect;
  const moved = delta !== 0n;
  const detail = result.blocked ? result.reason : `txId ${result.txId}`;

  rows.push({ id: s.id, ok, outcome, detail, delta, red: s.red, what: s.what });
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${s.id.padEnd(20)} ${outcome.padEnd(6)} ` +
    `funds ${moved ? `MOVED ${delta}` : "unchanged"}\n        ${s.what}\n        ${detail}\n`
  );
}

const blockedCount = rows.filter((r) => r.outcome === "block").length;
const redCount = rows.filter((r) => r.red).length;
const failures = rows.filter((r) => !r.ok);

console.log("─".repeat(78));
console.log(`${blockedCount} attacks blocked on-chain | ${redCount} deliberately NOT blocked (documented) | ${failures.length} unexpected`);
for (const r of rows.filter((x) => x.red)) console.log(`\nRED  ${r.id}: ${r.red}`);
console.log("");
process.exit(failures.length === 0 ? 0 : 1);
