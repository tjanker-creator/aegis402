// Creates the OPERATOR account — the agent's day-to-day signing key.
//
// After the vault rekey, the agent's funds can only move via the vault
// LogicSig, and the LogicSig only signs an asset transfer when the bound guard
// call is present. That guard call has to be signed by something, and it must
// NOT be the vault. So the agent runs with a separate operational key that
// holds no money at all: if it leaks, the attacker gains the ability to ask
// the guard for permission, and nothing else.
import algosdk from "algosdk";
import { appendFileSync } from "node:fs";
import { algod, account } from "../src/common.mjs";
import "dotenv/config";

let addr, sk;
if (process.env.OPERATOR_MNEMONIC) {
  ({ addr, sk } = account("OPERATOR"));
  console.log(`OPERATOR exists: ${addr}`);
} else {
  const a = algosdk.generateAccount();
  addr = a.addr.toString(); sk = a.sk;
  appendFileSync(".env", `\n# OPERATOR: signs guard app-calls, holds no funds\nOPERATOR_ADDRESS=${addr}\nOPERATOR_MNEMONIC="${algosdk.secretKeyToMnemonic(a.sk)}"\n`);
  console.log(`OPERATOR created: ${addr}`);
}

// Fund it from the merchant account with the bare minimum to exist.
const info = await algod.accountInformation(addr).do().catch(() => ({ amount: 0n }));
if (BigInt(info.amount ?? 0) < 150000n) {
  const m = account("MERCHANT");
  const sp = await algod.getTransactionParams().do();
  const fund = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: m.addr, receiver: addr, amount: 200000, suggestedParams: sp,
  });
  const { txid } = await algod.sendRawTransaction(fund.signTxn(m.sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  console.log(`funded with 0.2 ALGO from MERCHANT (${txid})`);
} else {
  console.log("already funded");
}
console.log("\nThis key can request permission. It cannot spend.");
