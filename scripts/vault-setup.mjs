// Compiles the vault LogicSig and rekeys the agent account to it.
//
// After this runs, the agent's own key can no longer move its USDC. Only the
// logic signature can — and it only signs when the bound guard app call is in
// the same group. The guard stops being optional.
import algosdk from "algosdk";
import { readFileSync, appendFileSync } from "node:fs";
import { algod, account } from "../src/common.mjs";
import "dotenv/config";

const GUARD_APP_ID = Number(process.env.POLICY_APP_ID);
if (!GUARD_APP_ID) throw new Error("POLICY_APP_ID missing — run scripts/deploy.mjs first");

const src = readFileSync(new URL("../contracts/vault.teal.tmpl", import.meta.url), "utf8")
  .replace("int GUARD_APP_ID", `int ${GUARD_APP_ID}`);

const compiled = await algod.compile(src).do();
const program = Buffer.from(compiled.result, "base64");
const lsig = new algosdk.LogicSigAccount(program);
console.log(`vault LogicSig address : ${lsig.address()}`);
console.log(`program hash           : ${compiled.hash}`);
console.log(`bound guard app        : ${GUARD_APP_ID}`);

// Rekey the agent account so the LogicSig becomes its sole spending authority.
const { addr, sk } = account("AGENT");
const info = await algod.accountInformation(addr).do();
const current = info.authAddr ? info.authAddr.toString() : addr;

if (current === lsig.address().toString()) {
  console.log("\nAgent account is already rekeyed to this vault.");
} else {
  const sp = await algod.getTransactionParams().do();
  const rekey = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: addr, receiver: addr, amount: 0,
    rekeyTo: lsig.address(), suggestedParams: sp,
  });
  const { txid } = await algod.sendRawTransaction(rekey.signTxn(sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 5);
  console.log(`\nRekeyed agent account to the vault (${txid})`);
}

appendFileSync(".env", `VAULT_LSIG_B64=${compiled.result}\nVAULT_ADDRESS=${lsig.address()}\nVAULT_HASH=${compiled.hash}\n`);
console.log("\nThe agent's own key can no longer move its USDC.");
console.log("Verify independently:");
console.log(`  curl -s https://testnet-api.algonode.cloud/v2/accounts/${addr} | jq -r '.["auth-addr"]'`);
console.log(`  must equal  ${lsig.address()}`);
