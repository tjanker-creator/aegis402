// Sets up the v2 stack: treasury, guard-with-fee, a fresh vault account.
//
//   node scripts/setup-v2.mjs
//
// v1 is left completely untouched — it stays as the historical proof.
import algosdk from "algosdk";
import { readFileSync, appendFileSync } from "node:fs";
import { algod, account, USDC_ASA_ID, usdcBalance } from "../src/common.mjs";
import "dotenv/config";

const CAP_MICRO = Number(process.env.CAP_MICRO ?? 50000);
const FEE_MIN = Number(process.env.FEE_MIN ?? 100); // 0.0001 USDC floor
const merchant = account("MERCHANT");
const funder = account("AGENT"); // v1 vault: can still pay the merchant only

function ensure(role, note) {
  if (process.env[`${role}_MNEMONIC`]) return account(role);
  const a = algosdk.generateAccount();
  appendFileSync(".env", `\n# ${note}\n${role}_ADDRESS=${a.addr}\n${role}_MNEMONIC="${algosdk.secretKeyToMnemonic(a.sk)}"\n`);
  console.log(`${role} created: ${a.addr}`);
  return { addr: a.addr.toString(), sk: a.sk };
}

// 1 — the guard's treasury, and the v2 agent account
const treasury = ensure("TREASURY", "TREASURY: receives the guard fee");
const agent2 = ensure("AGENT2", "AGENT2: v2 vault-governed agent account");

// 2 — fund them with ALGO + USDC opt-in, paid for by the merchant account
for (const [who, algoNeeded] of [[treasury, 300000], [agent2, 500000]]) {
  const info = await algod.accountInformation(who.addr).do().catch(() => ({ amount: 0n }));
  if (BigInt(info.amount ?? 0) < BigInt(algoNeeded)) {
    const sp = await algod.getTransactionParams().do();
    const t = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: merchant.addr, receiver: who.addr, amount: algoNeeded, suggestedParams: sp,
    });
    const { txid } = await algod.sendRawTransaction(t.signTxn(merchant.sk)).do();
    await algosdk.waitForConfirmation(algod, txid, 4);
    console.log(`funded ${who.addr.slice(0, 8)}… with ${algoNeeded / 1e6} ALGO`);
  }
  if ((await usdcBalance(who.addr)) === null) {
    const sp = await algod.getTransactionParams().do();
    const t = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: who.addr, receiver: who.addr, assetIndex: USDC_ASA_ID, amount: 0, suggestedParams: sp,
    });
    const { txid } = await algod.sendRawTransaction(t.signTxn(who.sk)).do();
    await algosdk.waitForConfirmation(algod, txid, 4);
    console.log(`${who.addr.slice(0, 8)}… opted in to USDC`);
  }
}

// 3 — give AGENT2 something to spend (from the merchant's balance)
if ((await usdcBalance(agent2.addr)) < 200000n) {
  const have = await usdcBalance(merchant.addr);
  const send = have > 400000n ? 400000n : have - 10000n;
  if (send > 0n) {
    const sp = await algod.getTransactionParams().do();
    const t = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: merchant.addr, receiver: agent2.addr, assetIndex: USDC_ASA_ID,
      amount: Number(send), suggestedParams: sp,
    });
    const { txid } = await algod.sendRawTransaction(t.signTxn(merchant.sk)).do();
    await algosdk.waitForConfirmation(algod, txid, 4);
    console.log(`seeded AGENT2 with ${Number(send) / 1e6} USDC`);
  }
}

// 4 — deploy guard v2 (immutable, fee enforced)
const clear = Buffer.from((await algod.compile(readFileSync(new URL("../contracts/clear.teal", import.meta.url), "utf8")).do()).result, "base64");
const guardSrc = readFileSync(new URL("../contracts/policy2.teal", import.meta.url), "utf8")
  .replace("int CAP_MICRO", `int ${CAP_MICRO}`)
  .replace("addr ALLOWED_RECEIVER", `addr ${merchant.addr}`)
  .replace("addr GUARD_TREASURY", `addr ${treasury.addr}`)
  .replace("int FEE_MIN", `int ${FEE_MIN}`);
const approval = Buffer.from((await algod.compile(guardSrc).do()).result, "base64");
const sp = await algod.getTransactionParams().do();
const create = algosdk.makeApplicationCreateTxnFromObject({
  sender: merchant.addr, suggestedParams: sp,
  onComplete: algosdk.OnApplicationComplete.NoOpOC,
  approvalProgram: approval, clearProgram: clear,
  numGlobalInts: 0, numGlobalByteSlices: 0, numLocalInts: 0, numLocalByteSlices: 0,
});
const cr = await algod.sendRawTransaction(create.signTxn(merchant.sk)).do();
const crRes = await algosdk.waitForConfirmation(algod, cr.txid, 5);
const guard2 = Number(crRes.applicationIndex ?? crRes["application-index"]);
console.log(`\nGUARD v2 appId=${guard2}  (cap ${CAP_MICRO}, fee >= max(1%, ${FEE_MIN}) to treasury)`);

// 5 — compile vault v2 bound to that guard, and rekey AGENT2 to it
const vaultSrc = readFileSync(new URL("../contracts/vault2.teal.tmpl", import.meta.url), "utf8")
  .replace("int GUARD_APP_ID", `int ${guard2}`);
const vc = await algod.compile(vaultSrc).do();
const lsig = new algosdk.LogicSigAccount(Buffer.from(vc.result, "base64"));
console.log(`VAULT v2 ${lsig.address()}`);

const info2 = await algod.accountInformation(agent2.addr).do();
const currentAuth = info2.authAddr ? info2.authAddr.toString() : agent2.addr;
if (currentAuth !== lsig.address().toString()) {
  const sp2 = await algod.getTransactionParams().do();
  const rekey = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: agent2.addr, receiver: agent2.addr, amount: 0,
    rekeyTo: lsig.address(), suggestedParams: sp2,
  });
  const { txid } = await algod.sendRawTransaction(rekey.signTxn(agent2.sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 5);
  console.log(`AGENT2 rekeyed to vault v2 (${txid})`);
}

appendFileSync(".env", `\n# v2 stack\nGUARD2_APP_ID=${guard2}\nVAULT2_LSIG_B64=${vc.result}\nVAULT2_ADDRESS=${lsig.address()}\nFEE_MIN=${FEE_MIN}\n`);
console.log(`\nv2 ready. AGENT2 holds ${Number(await usdcBalance(agent2.addr)) / 1e6} USDC and cannot spend it without paying the guard.`);
