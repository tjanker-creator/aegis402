// Proves the guard bills itself: a payment settles only when the same atomic
// group also pays the guard's treasury.
//
//   node scripts/fee-test.mjs
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE, b64, facilitator, requirements, payload, facilitatorFeePayer, usdcBalance } from "../src/common.mjs";
import { condense } from "../src/aegis.mjs";
import "dotenv/config";

const GUARD2 = Number(process.env.GUARD2_APP_ID);
const CAP = Number(process.env.CAP_MICRO ?? 50000);
const FEE_MIN = Number(process.env.FEE_MIN ?? 100);
const payer = account("MERCHANT");
const receiver = account("AGENT").addr;
const treasury = account("TREASURY").addr;
const attacker = account("ATTACKER").addr;

/** [0] facilitator fee  [1] guard call  [2] guard fee  [3] payment */
async function build({ amount, fee, feeTo = treasury, payTo = receiver, extraPayment = false }) {
  const feePayer = await facilitatorFeePayer();
  const sp = await algod.getTransactionParams().do();
  const size = extraPayment ? 5 : 4;
  const pooled = { ...sp, fee: MIN_FEE * size, flatFee: true };
  const zero = { ...sp, fee: 0, flatFee: true };
  const payIndex = 3;

  const idx = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };

  const txns = [
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: feePayer, receiver: feePayer, amount: 0,
      note: new TextEncoder().encode("x402-fee-payer"), suggestedParams: pooled,
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: payer.addr, appIndex: GUARD2, appArgs: [idx(payIndex), idx(2)], suggestedParams: zero,
    }),
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: payer.addr, receiver: feeTo, assetIndex: USDC_ASA_ID, amount: fee,
      note: new TextEncoder().encode("aegis-guard-fee"), suggestedParams: zero,
    }),
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: payer.addr, receiver: payTo, assetIndex: USDC_ASA_ID, amount,
      note: new TextEncoder().encode("x402-payment-v2"), suggestedParams: zero,
    }),
  ];
  if (extraPayment) {
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: payer.addr, receiver: payTo, assetIndex: USDC_ASA_ID, amount,
      note: new TextEncoder().encode("x402-payment-v2"), suggestedParams: zero,
    }));
  }

  algosdk.assignGroupID(txns);
  const group = txns.map((t, i) => i === 0 ? b64(algosdk.encodeUnsignedTransaction(t)) : b64(t.signTxn(payer.sk)));
  const feePayerAddr = feePayer;
  return {
    paymentPayload: payload(group, payIndex),
    paymentRequirements: requirements({ amount: String(amount), payTo, feePayer: feePayerAddr }),
  };
}

async function run(name, what, opts, expect) {
  const before = await usdcBalance(treasury);
  let out;
  try {
    const built = await build(opts);
    const v = await facilitator("/verify", built.paymentPayload, built.paymentRequirements);
    if (v.body?.isValid !== true) out = { blocked: true, why: condense(v.body?.invalidReason ?? JSON.stringify(v.body)) };
    else {
      const s = await facilitator("/settle", built.paymentPayload, built.paymentRequirements);
      out = s.body?.success === true
        ? { blocked: false, txId: s.body.transaction }
        : { blocked: true, why: condense(s.body?.errorReason ?? JSON.stringify(s.body)) };
    }
  } catch (e) { out = { error: String(e.message ?? e).slice(0, 120) }; }

  await new Promise((r) => setTimeout(r, out.blocked ? 400 : 5000));
  const after = await usdcBalance(treasury);
  const earned = (after ?? 0n) - (before ?? 0n);
  const outcome = out.error ? "ERROR" : out.blocked ? "block" : "settle";
  const ok = outcome === expect;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(22)} ${outcome.padEnd(6)} treasury ${earned >= 0n ? "+" : ""}${earned}`);
  console.log(`        ${what}`);
  console.log(`        ${out.error ?? out.why ?? "txId " + out.txId}\n`);
  return ok;
}

console.log(`\nAEGIS402 guard v2 — the fee is a precondition, not an invoice`);
console.log(`app ${GUARD2} | cap ${CAP} | fee >= max(1%, ${FEE_MIN}) to ${treasury.slice(0, 10)}…\n`);

const results = [];
results.push(await run("pays-the-guard", "Payment that carries the guard's fee", { amount: 10000, fee: 100 }, "settle"));
results.push(await run("no-fee", "Same payment with no fee transaction at all", { amount: 10000, fee: 0, feeTo: treasury }, "block"));
results.push(await run("fee-too-small", "Fee below one percent of the payment", { amount: 40000, fee: 100 }, "block"));
results.push(await run("fee-misdirected", "Fee paid to the attacker instead of the treasury", { amount: 10000, fee: 100, feeTo: attacker }, "block"));
results.push(await run("payee-not-allowed", "Payment redirected to the attacker", { amount: 10000, fee: 100, payTo: attacker }, "block"));
results.push(await run("cap-multiplied", "Two payments in one group, each within the cap", { amount: CAP, fee: 1000, extraPayment: true }, "block"));

const failed = results.filter((r) => !r).length;
console.log("─".repeat(74));
console.log(`${results.length - failed}/${results.length} as expected`);
process.exit(failed === 0 ? 0 : 1);
