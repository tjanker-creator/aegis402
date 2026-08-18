// AEGIS402 — enforcement WITHOUT the facilitator.
//
// Every other battery in this repo observes a refusal through the hosted
// facilitator, which reaches it via `algod simulate`. That invites the fair
// question: is this a ledger property, or a courtesy of one server?
//
// This script removes the facilitator entirely. It builds the same guard +
// payment group, signs every transaction, and submits it DIRECTLY to a public
// algod node. What refuses here is the node running the approval program, and
// atomicity is what makes that refusal cost the payment.
import "dotenv/config";
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE, usdcBalance, fmtUsdc } from "../src/common.mjs";

const GUARD = Number(process.env.POLICY_APP_ID);
const CAP   = Number(process.env.CAP_MICRO ?? 50000);
const agent    = account("AGENT");
const operator = account("OPERATOR");
const merchant = process.env.MERCHANT_ADDRESS;
const attacker = process.env.ATTACKER_ADDRESS;
const vault    = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64, "base64"));

/** [0] guard app-call (operator, pays the pooled fee)  [1] payment (vault, fee 0) */
async function build({ amount, receiver, withGuard = true }) {
  const sp = await algod.getTransactionParams().do();
  const size = withGuard ? 2 : 1;
  const payIdx = withGuard ? 1 : 0;
  const txns = [];

  if (withGuard) {
    const arg = new Uint8Array(8);
    new DataView(arg.buffer).setBigUint64(0, BigInt(payIdx));
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender: operator.addr, appIndex: GUARD, appArgs: [arg],
      suggestedParams: { ...sp, fee: MIN_FEE * (size + 1), flatFee: true },
    }));
  }
  txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: agent.addr, receiver, assetIndex: USDC_ASA_ID, amount,
    suggestedParams: { ...sp, fee: withGuard ? 0 : MIN_FEE * 2, flatFee: true },
  }));
  if (txns.length > 1) algosdk.assignGroupID(txns);

  return txns.map((t, i) =>
    i === payIdx ? algosdk.signLogicSigTransactionObject(t, vault).blob
                 : t.signTxn(operator.sk));
}

const short = (m) => {
  const s = String(m).replace(/\s+/g, " ");
  const hit = s.match(/rejected by (ApprovalProgram|logic)[^,;]*/i)
           || s.match(/logic eval error[^,;]*/i);
  return (hit ? hit[0] : s).slice(0, process.env.FULLERR ? 600 : 120);
};

async function run(name, why, opts, expect) {
  process.stdout.write(`  ${name.padEnd(24)}`);
  let outcome, detail;
  try {
    const signed = await build(opts);
    const { txid } = await algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(algod, txid, 4);
    outcome = "settled"; detail = `txId ${txid}`;
  } catch (e) {
    outcome = "blocked"; detail = short(e.message ?? e);
  }
  const ok = outcome === expect;
  console.log(`${ok ? "PASS" : "FAIL"}  ${outcome}`);
  console.log(`        ${why}`);
  console.log(`        ${detail}`);
  return ok;
}

console.log(`AEGIS402 — the node refuses, with no facilitator in the loop`);
console.log(`guard ${GUARD} | cap ${CAP} | direct submission to ${process.env.ALGOD_URL ?? "testnet-api.algonode.cloud"}\n`);

const before = await usdcBalance(attacker);
const results = [];
results.push(await run("guarded-payment", "Within cap, to the allowlisted merchant",
  { amount: 20000, receiver: merchant }, "settled"));
results.push(await run("redirect-to-attacker", "Same group, receiver swapped for the attacker",
  { amount: 20000, receiver: attacker }, "blocked"));
results.push(await run("over-the-cap", "Ten times the cap, to the allowlisted merchant",
  { amount: CAP * 10, receiver: merchant }, "blocked"));
results.push(await run("guard-omitted", "The payment alone, no guard call in the group",
  { amount: 20000, receiver: merchant, withGuard: false }, "blocked"));
const after = await usdcBalance(attacker);

console.log("\n" + "─".repeat(74));
console.log(`attacker balance   ${fmtUsdc(before)}  →  ${fmtUsdc(after)}`);
console.log(`${results.filter(Boolean).length}/${results.length} as expected — refused by the node, not by a server`);
