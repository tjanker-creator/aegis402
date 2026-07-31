// Deploys the immutable Deadbolt policy app (+ a no-op app used by the M0 spike).
// Writes the resulting app IDs into .env so every other script picks them up.
import algosdk from "algosdk";
import { readFileSync, appendFileSync, readFileSync as rf } from "node:fs";
import { algod, account } from "../src/common.mjs";

const CAP_MICRO = Number(process.env.CAP_MICRO ?? 50000); // 0.05 USDC per transaction
const { addr, sk } = account("AGENT");
const merchant = account("MERCHANT").addr;

async function deploy(name, approvalSrc) {
  const clearSrc = readFileSync(new URL("../contracts/clear.teal", import.meta.url), "utf8");
  const approval = Buffer.from((await algod.compile(approvalSrc).do()).result, "base64");
  const clear = Buffer.from((await algod.compile(clearSrc).do()).result, "base64");
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: addr, suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: approval, clearProgram: clear,
    numGlobalInts: 0, numGlobalByteSlices: 0, numLocalInts: 0, numLocalByteSlices: 0,
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(sk)).do();
  const res = await algosdk.waitForConfirmation(algod, txid, 5);
  const appId = Number(res.applicationIndex ?? res["application-index"]);
  console.log(`${name.padEnd(16)} appId=${appId}  (${txid})`);
  return appId;
}

// 1) The real Deadbolt policy, with cap + allowlisted merchant baked in (immutable).
const policySrc = readFileSync(new URL("../contracts/policy.teal", import.meta.url), "utf8")
  .replace("int CAP_MICRO", `int ${CAP_MICRO}`)
  .replace("addr ALLOWED_RECEIVER", `addr ${merchant}`);
const policyId = await deploy("POLICY", policySrc);

// 2) A trivially-approving app: proves an extra client-signed app-call is
//    tolerated inside the payment group (the M0 crux test).
const noopId = await deploy("NOOP_APPROVE", "#pragma version 10\nint 1\nreturn\n");

// 3) An app that approves its own creation but rejects every call afterwards:
//    proves a FAILING guard kills the whole payment group (the mutant test).
const rejectId = await deploy("NOOP_REJECT",
  "#pragma version 10\ntxn ApplicationID\nint 0\n==\nbnz allow\nint 0\nreturn\nallow:\nint 1\nreturn\n");

appendFileSync(".env", `\n# Deployed ${new Date().toISOString()}\nPOLICY_APP_ID=${policyId}\nNOOP_APP_ID=${noopId}\nREJECT_APP_ID=${rejectId}\nCAP_MICRO=${CAP_MICRO}\n`);
console.log(`\nPolicy: cap ${CAP_MICRO} microUSDC, allowlisted receiver ${merchant}`);
console.log("App IDs appended to .env");
