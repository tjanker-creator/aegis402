// AEGIS402 — deploy guard v3 and stand up an account it protects.
//
// v3 requires the zkTLS registry call to be present in the payment group, so a
// payment that cannot show where its payee came from does not settle. The old
// agent account cannot be moved to it: it is rekeyed to the v1 vault, which
// refuses to sign anything but an asset transfer and forbids RekeyTo. That is
// the unfixability we claim, working against us, exactly as advertised.
//
// So this creates a fresh account, opts it into USDC, seeds it, and rekeys it
// to a vault bound to v3. After the rekey its key is inert: only the vault
// signs, and only when a v3 guard call rides along.
import "dotenv/config";
import { readFileSync, appendFileSync } from "node:fs";
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE } from "../src/common.mjs";

const operator = account("OPERATOR");
const merchant = account("MERCHANT");
const CAP = Number(process.env.CAP_MICRO ?? 50000);
const wait = (id) => algosdk.waitForConfirmation(algod, id, 5);
const send = async (txn, sk) => {
  const { txid } = await algod.sendRawTransaction(txn.signTxn(sk)).do();
  return wait(txid);
};

// ---------- 1. the guard ----------------------------------------------------
const guardSrc = readFileSync("contracts/policy3.teal", "utf8")
  .replace(/int CAP_MICRO/g, `int ${CAP}`)
  .replace(/addr ALLOWED_RECEIVER/g, `addr ${process.env.MERCHANT_ADDRESS}`)
  .replace(/int GUARDED_ASSET/g, `int ${USDC_ASA_ID}`)
  .replace(/int REGISTRY_APP_ID/g, `int ${process.env.REGISTRY_APP_ID}`)
  .replace(/byte "ATTESTED_TEXT"/g, `byte "${process.env.MERCHANT_ADDRESS}"`);
const clearSrc = readFileSync("contracts/clear.teal", "utf8");

const compile = async (src) =>
  new Uint8Array(Buffer.from((await algod.compile(src).do()).result, "base64"));

const sp = await algod.getTransactionParams().do();
const created = await send(algosdk.makeApplicationCreateTxnFromObject({
  sender: operator.addr, suggestedParams: sp,
  onComplete: algosdk.OnApplicationComplete.NoOpOC,
  approvalProgram: await compile(guardSrc), clearProgram: await compile(clearSrc),
  numGlobalInts: 0, numGlobalByteSlices: 0, numLocalInts: 0, numLocalByteSlices: 0,
}), operator.sk);
const GUARD3 = Number(created.applicationIndex ?? created["application-index"]);
console.log(`guard v3 deployed        app ${GUARD3}`);

// ---------- 2. the vault bound to it ---------------------------------------
const vaultSrc = readFileSync("contracts/vault.teal.tmpl", "utf8")
  .replace("int GUARD_APP_ID", `int ${GUARD3}`);
const vault = new algosdk.LogicSigAccount(await compile(vaultSrc));
console.log(`vault bound to v3        ${vault.address()}`);

// ---------- 3. a fresh account for it to protect ---------------------------
const payer = algosdk.generateAccount();
console.log(`new guarded account      ${payer.addr}`);

await send(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: operator.addr, receiver: payer.addr, amount: 350000, suggestedParams: sp,
}), operator.sk);
console.log(`  funded 0.35 ALGO`);

await send(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: payer.addr, receiver: payer.addr, assetIndex: USDC_ASA_ID, amount: 0,
  suggestedParams: await algod.getTransactionParams().do(),
}), payer.sk);
console.log(`  opted into USDC ${USDC_ASA_ID}`);

await send(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: merchant.addr, receiver: payer.addr, assetIndex: USDC_ASA_ID, amount: 400000,
  suggestedParams: await algod.getTransactionParams().do(),
}), merchant.sk);
console.log(`  seeded 0.4 USDC from the merchant`);

// ---------- 4. the rekey: after this, only the vault signs ------------------
await send(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: payer.addr, receiver: payer.addr, amount: 0,
  rekeyTo: vault.address().toString(),
  suggestedParams: await algod.getTransactionParams().do(),
}), payer.sk);
const info = await algod.accountInformation(payer.addr).do();
const auth = (info["auth-addr"] ?? info.authAddr)?.toString();
console.log(`  rekeyed → auth-addr ${auth}`);
console.log(`  matches the compiled vault: ${auth === vault.address().toString() ? "YES" : "NO"}`);

appendFileSync(".env", `\n# guard v3 — attestation is mandatory (deployed ${new Date().toISOString().slice(0,10)})\n` +
  `GUARD3_APP_ID=${GUARD3}\nV3_PAYER_ADDRESS=${payer.addr}\n` +
  `V3_PAYER_MNEMONIC="${algosdk.secretKeyToMnemonic(payer.sk)}"\n` +
  `V3_VAULT_LSIG_B64=${Buffer.from(vault.lsig.logic).toString("base64")}\n`);
console.log(`\nwritten to .env: GUARD3_APP_ID, V3_PAYER_ADDRESS, V3_VAULT_LSIG_B64`);
console.log(`next: npm run attested3`);
