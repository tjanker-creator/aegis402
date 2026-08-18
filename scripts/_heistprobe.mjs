// READ-ONLY probe: algod simulate of every proposed "heist" row. No submission.
import "dotenv/config";
import algosdk from "algosdk";
import fs from "node:fs";
import { algod, account, USDC_ASA_ID, MIN_FEE } from "/Users/tj/aegis402/src/common.mjs";

const GUARD = Number(process.env.POLICY_APP_ID);
const agent = account("AGENT");
const operator = account("OPERATOR");
const merchant = process.env.MERCHANT_ADDRESS;
const attacker = process.env.ATTACKER_ADDRESS;
const vault = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64, "base64"));
const idx = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };

// 0. verify vault bytecode == compile(vault.teal.tmpl, GUARD_APP_ID=768360225)
const tmpl = fs.readFileSync("/Users/tj/aegis402/contracts/vault.teal.tmpl", "utf8").replace(/GUARD_APP_ID/g, String(GUARD));
const c = await algod.compile(tmpl).do();
console.log("recompiled vault hash :", c.hash);
console.log(".env VAULT_ADDRESS    :", process.env.VAULT_ADDRESS);
console.log("bytecode identical    :", Buffer.from(c.result,"base64").toString("base64") === process.env.VAULT_LSIG_B64);
console.log("lsig account addr     :", vault.address().toString());
console.log("");

async function sim(name, txns, signers) {
  algosdk.assignGroupID(txns);
  const stxns = txns.map((t,i) => signers[i](t));
  const req = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [ new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: stxns.map(b => algosdk.decodeSignedTransaction(b)) }) ],
  });
  try {
    const r = await algod.simulateTransactions(req).do();
    const g = r.txnGroups[0];
    if (g.failureMessage) { const s=String(g.failureMessage).replace(/\s+/g," "); const hit=s.match(/rejected by (ApprovalProgram|logic)[^,;]*/i); console.log(`${name.padEnd(30)} BLOCKED  ${hit?hit[0]:s.slice(0,160)}`); }
    else console.log(`${name.padEnd(24)} WOULD SETTLE`);
  } catch (e) {
    console.log(`${name.padEnd(24)} ERROR    ${String(e.message ?? e).replace(/\s+/g," ").slice(0,200)}`);
  }
}

const sp = await algod.getTransactionParams().do();
const pooled = (n) => ({ ...sp, fee: MIN_FEE * n, flatFee: true });
const zero   = { ...sp, fee: 0, flatFee: true };
const byOp   = (t) => t.signTxn(operator.sk);
const byVault= (t) => algosdk.signLogicSigTransactionObject(t, vault).blob;

const guardCall = (payIdx, extraArgsIdx) => algosdk.makeApplicationNoOpTxnFromObject({
  sender: operator.addr, appIndex: GUARD, appArgs: [idx(payIdx)], suggestedParams: pooled(3),
});

// ROW 1 anchor
await sim("anchor-guarded-payment", [
  guardCall(1),
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: merchant, assetIndex: USDC_ASA_ID, amount: 20000, suggestedParams: zero }),
], [byOp, byVault]);

// ROW 2 redirect
await sim("redirect-operator-key", [
  guardCall(1),
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: attacker, assetIndex: USDC_ASA_ID, amount: 20000, suggestedParams: zero }),
], [byOp, byVault]);

// ROW 3 over-the-cap
await sim("over-the-cap", [
  guardCall(1),
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: merchant, assetIndex: USDC_ASA_ID, amount: 500000, suggestedParams: zero }),
], [byOp, byVault]);

// ROW 4 steal-the-ALGO  (vault-signed PAYMENT)
await sim("steal-the-ALGO", [
  algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: operator.addr, receiver: operator.addr, amount: 0, suggestedParams: pooled(2) }),
  algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: attacker, amount: 1, suggestedParams: zero }),
], [byOp, byVault]);

// ROW 5 rekey-away  (arg naming index 1 == correct)
await sim("rekey-away(arg=1)", [
  guardCall(1),
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: merchant, assetIndex: USDC_ASA_ID, amount: 20000, suggestedParams: zero, rekeyTo: attacker }),
], [byOp, byVault]);

// ROW 5b rekey-away with the arg the proposal literally specifies (itob(2))
await sim("rekey-away(arg=2,as-proposed)", [
  guardCall(2),
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: merchant, assetIndex: USDC_ASA_ID, amount: 20000, suggestedParams: zero, rekeyTo: attacker }),
], [byOp, byVault]);

// ROW 6 guard-omitted
await sim("guard-omitted", [
  algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: attacker, assetIndex: USDC_ASA_ID, amount: 20000, suggestedParams: pooled(2) }),
], [byVault]);
