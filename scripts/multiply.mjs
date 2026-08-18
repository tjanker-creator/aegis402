// AEGIS402 — a per-transaction predicate is not a per-group policy.
//
// x402's exact-AVM scheme validates the transaction at `paymentIndex`. It does
// not bound the rest of the group. Our own guard v1 has the same shape: it is
// handed one index and checks that one payment against the cap. Both predicates
// are LOCAL. Composed, they compose badly: an Algorand group holds sixteen
// transactions, so seven (guard, payment) pairs ride beside the facilitator's
// fee-payer, each pair individually legal, and the cap silently degrades to a
// per-transaction limit.
//
// Row 1 settles that group through the LIVE GoPlausible facilitator.
// Row 2 sends the same shape at guard v2, which counts the group and refuses.
import "dotenv/config";
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE, b64, facilitator, requirements,
         payload, facilitatorFeePayer, usdcBalance, fmtUsdc } from "../src/common.mjs";
import { condense } from "../src/aegis.mjs";

const GUARD1 = Number(process.env.POLICY_APP_ID);
const GUARD2 = Number(process.env.GUARD2_APP_ID);
const CAP    = Number(process.env.CAP_MICRO ?? 50000);
const PAIRS  = 7;

const agent    = account("AGENT");
const operator = account("OPERATOR");
const v2payer  = account("MERCHANT");          // guard v2's battery payer
const merchant = process.env.MERCHANT_ADDRESS;
const treasury = process.env.TREASURY_ADDRESS;
const vault    = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64, "base64"));
const idx = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };

/** v1: [0] facilitator fee-payer, then PAIRS x (guard call, payment). paymentIndex = 2. */
async function buildV1(feePayer, sp) {
  const size = 1 + PAIRS * 2;
  const zero = { ...sp, fee: 0, flatFee: true };
  const txns = [algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: feePayer, receiver: feePayer, amount: 0,
    note: new TextEncoder().encode("x402-fee-payer"),
    suggestedParams: { ...sp, fee: MIN_FEE * size, flatFee: true },
  })];
  for (let j = 0; j < PAIRS; j++) {
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender: operator.addr, appIndex: GUARD1, appArgs: [idx(2 + 2 * j)], suggestedParams: zero }));
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: agent.addr, receiver: merchant, assetIndex: USDC_ASA_ID, amount: CAP,
      note: new TextEncoder().encode("x402-payment-" + j), suggestedParams: zero }));
  }
  algosdk.assignGroupID(txns);
  const group = txns.map((t, i) => i === 0 ? b64(algosdk.encodeUnsignedTransaction(t))
    : i % 2 === 0 ? b64(algosdk.signLogicSigTransactionObject(t, vault).blob)
                  : b64(t.signTxn(operator.sk)));
  return { paymentPayload: payload(group, 2),
           paymentRequirements: requirements({ amount: String(CAP), payTo: merchant, feePayer }) };
}

/** v2: same shape, guard v2, plus the guard fee it demands. */
async function buildV2(feePayer, sp) {
  const size = 2 + PAIRS * 2;
  const zero = { ...sp, fee: 0, flatFee: true };
  const feeIdx = size - 1;
  const txns = [algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: feePayer, receiver: feePayer, amount: 0,
    note: new TextEncoder().encode("x402-fee-payer"),
    suggestedParams: { ...sp, fee: MIN_FEE * size, flatFee: true },
  })];
  for (let j = 0; j < PAIRS; j++) {
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender: v2payer.addr, appIndex: GUARD2, appArgs: [idx(2 + 2 * j), idx(feeIdx)], suggestedParams: zero }));
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: v2payer.addr, receiver: agent.addr, assetIndex: USDC_ASA_ID, amount: CAP,
      note: new TextEncoder().encode("x402-payment-" + j), suggestedParams: zero }));
  }
  txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: v2payer.addr, receiver: treasury, assetIndex: USDC_ASA_ID, amount: 5000,
    note: new TextEncoder().encode("aegis-guard-fee"), suggestedParams: zero }));
  algosdk.assignGroupID(txns);
  const group = txns.map((t, i) => i === 0 ? b64(algosdk.encodeUnsignedTransaction(t)) : b64(t.signTxn(v2payer.sk)));
  return { paymentPayload: payload(group, 2),
           paymentRequirements: requirements({ amount: String(CAP), payTo: agent.addr, feePayer }) };
}

const feePayer = await facilitatorFeePayer();
const sp = await algod.getTransactionParams().do();
const a0 = await usdcBalance(agent.addr);

console.log(`\nAEGIS402 — a per-transaction predicate is not a per-group policy`);
console.log(`guard v1 ${GUARD1} | guard v2 ${GUARD2} | cap ${CAP} microUSDC | facilitator ${process.env.FACILITATOR_URL}\n`);
console.log(`  the merchant's x402 requirement asks for ${CAP} microUSDC at paymentIndex 2.`);
console.log(`  the group carries ${PAIRS} payments of ${CAP} = ${PAIRS * CAP}.\n`);

// ── row 1 ────────────────────────────────────────────────────────────────────
const b1 = await buildV1(feePayer, sp);
const v1 = await facilitator("/verify", b1.paymentPayload, b1.paymentRequirements);
let row1 = "blocked", detail1 = condense(v1.body?.invalidReason ?? JSON.stringify(v1.body));
if (v1.body?.isValid === true) {
  console.log(`  cap-multiplied          facilitator /verify -> isValid: true`);
  const s = await facilitator("/settle", b1.paymentPayload, b1.paymentRequirements);
  if (s.body?.success === true) { row1 = "settled"; detail1 = s.body.transaction; }
  else detail1 = condense(s.body?.errorReason ?? JSON.stringify(s.body));
}
console.log(`  cap-multiplied          ${row1 === "settled" ? "SETTLED" : "blocked"}  guard v1 approved all ${PAIRS}, each within cap`);
console.log(`        ${row1 === "settled" ? "group settles — " + PAIRS * CAP + " microUSDC moves against a " + CAP + " requirement" : detail1}`);
if (row1 === "settled") console.log(`        https://lora.algokit.io/testnet/transaction/${detail1}`);

// ── row 2 ────────────────────────────────────────────────────────────────────
const b2 = await buildV2(feePayer, sp);
const v2 = await facilitator("/verify", b2.paymentPayload, b2.paymentRequirements);
let row2 = "settled", detail2 = "";
if (v2.body?.isValid !== true) { row2 = "blocked"; detail2 = condense(v2.body?.invalidReason ?? JSON.stringify(v2.body)); }
console.log(`\n  v2-counts-the-group     ${row2 === "blocked" ? "BLOCKED" : "settled"}  the same shape, sent to the group-aware guard`);
console.log(`        ${detail2 || "UNEXPECTED: v2 accepted a multi-payment group"}`);

await new Promise(r => setTimeout(r, 5000));
const a1 = await usdcBalance(agent.addr);
console.log("\n" + "─".repeat(74));
console.log(`agent USDC ${fmtUsdc(a0)} -> ${fmtUsdc(a1)}   (the cap said ${CAP})`);
console.log(`a per-transaction predicate is not a per-group policy.`);
