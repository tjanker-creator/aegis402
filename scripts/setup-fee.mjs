// Deploys guard v2 — the version whose approval requires the group to carry
// the guard's own fee. Deliberately lean: it reuses existing accounts, because
// the point being proven here is the fee, not the vault. Unskippability is
// already proven by v1.
//
//   node scripts/setup-fee.mjs
import algosdk from "algosdk";
import { readFileSync, appendFileSync } from "node:fs";
import { algod, account, USDC_ASA_ID, usdcBalance } from "../src/common.mjs";
import "dotenv/config";

const CAP_MICRO = Number(process.env.CAP_MICRO ?? 50000);
const FEE_MIN = Number(process.env.FEE_MIN ?? 100);

const payer = account("MERCHANT");     // holds USDC and its own key
const receiver = account("AGENT");     // allowlisted payee, already opted in
const treasury = account("TREASURY");  // receives the guard fee

// the treasury must be able to receive USDC
if ((await usdcBalance(treasury.addr)) === null) {
  const need = 150000;
  const ti = await algod.accountInformation(treasury.addr).do().catch(() => ({ amount: 0n }));
  if (BigInt(ti.amount ?? 0) < BigInt(need)) {
    const sp = await algod.getTransactionParams().do();
    const top = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: payer.addr, receiver: treasury.addr, amount: need, suggestedParams: sp,
    });
    const r = await algod.sendRawTransaction(top.signTxn(payer.sk)).do();
    await algosdk.waitForConfirmation(algod, r.txid, 4);
    console.log(`treasury topped up ${need / 1e6} ALGO`);
  }
  const sp2 = await algod.getTransactionParams().do();
  const optin = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: treasury.addr, receiver: treasury.addr, assetIndex: USDC_ASA_ID, amount: 0, suggestedParams: sp2,
  });
  const r2 = await algod.sendRawTransaction(optin.signTxn(treasury.sk)).do();
  await algosdk.waitForConfirmation(algod, r2.txid, 4);
  console.log("treasury opted in to USDC");
}

const src = readFileSync(new URL("../contracts/policy2.teal", import.meta.url), "utf8")
  .replace("int CAP_MICRO", `int ${CAP_MICRO}`)
  .replace("int GUARDED_ASSET", `int ${USDC_ASA_ID}`)
  .replace("addr ALLOWED_RECEIVER", `addr ${receiver.addr}`)
  .replace("addr GUARD_TREASURY", `addr ${treasury.addr}`)
  .replace("int FEE_MIN", `int ${FEE_MIN}`);
const clear = readFileSync(new URL("../contracts/clear.teal", import.meta.url), "utf8");
const ap = Buffer.from((await algod.compile(src).do()).result, "base64");
const cp = Buffer.from((await algod.compile(clear).do()).result, "base64");

const sp = await algod.getTransactionParams().do();
const create = algosdk.makeApplicationCreateTxnFromObject({
  sender: payer.addr, suggestedParams: sp,
  onComplete: algosdk.OnApplicationComplete.NoOpOC,
  approvalProgram: ap, clearProgram: cp,
  numGlobalInts: 0, numGlobalByteSlices: 0, numLocalInts: 0, numLocalByteSlices: 0,
});
const { txid } = await algod.sendRawTransaction(create.signTxn(payer.sk)).do();
const res = await algosdk.waitForConfirmation(algod, txid, 5);
const appId = Number(res.applicationIndex ?? res["application-index"]);

appendFileSync(".env", `\nGUARD2_APP_ID=${appId}\nFEE_MIN=${FEE_MIN}\n`);
console.log(`\nguard v2 appId ${appId}`);
console.log(`  cap        ${CAP_MICRO} microUSDC per payment`);
console.log(`  receiver   ${receiver.addr}`);
console.log(`  fee to     ${treasury.addr}`);
console.log(`  fee        >= max(1% of payment, ${FEE_MIN} microUSDC)`);
console.log(`  asset      pinned to ${USDC_ASA_ID}`);
console.log(`  group      exactly two asset transfers`);
