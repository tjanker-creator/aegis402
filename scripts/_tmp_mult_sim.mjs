import "dotenv/config";
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE } from "/Users/tj/aegis402/src/common.mjs";

const GUARD1 = Number(process.env.POLICY_APP_ID);
const CAP    = Number(process.env.CAP_MICRO ?? 50000);
const agent    = account("AGENT");
const operator = account("OPERATOR");
const merchant = process.env.MERCHANT_ADDRESS;
const vault = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64, "base64"));
const idx = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };

async function buildV1(pairs) {
  const sp = await algod.getTransactionParams().do();
  const total = pairs * 2;
  const txns = [];
  for (let j = 0; j < pairs; j++) {
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender: operator.addr, appIndex: GUARD1, appArgs: [idx(2*j+1)],
      suggestedParams: { ...sp, fee: j === 0 ? MIN_FEE * total : 0, flatFee: true },
    }));
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: agent.addr, receiver: merchant, assetIndex: USDC_ASA_ID, amount: CAP,
      suggestedParams: { ...sp, fee: 0, flatFee: true },
    }));
  }
  algosdk.assignGroupID(txns);
  return txns.map((t, i) => i % 2 === 1
    ? algosdk.signLogicSigTransactionObject(t, vault).blob
    : t.signTxn(operator.sk));
}

async function sim(label, signed) {
  try {
    const r = await algod.simulateRawTransactions(signed).do();
    const g = r.txnGroups[0];
    const budget = g.appBudgetConsumed ?? g["app-budget-consumed"];
    const added  = g.appBudgetAdded ?? g["app-budget-added"];
    if (g.failureMessage) {
      console.log(`${label.padEnd(22)} REJECTED  ${String(g.failureMessage).slice(0,150)}`);
    } else {
      console.log(`${label.padEnd(22)} WOULD SETTLE  appBudget ${budget}/${added}`);
    }
  } catch (e) {
    console.log(`${label.padEnd(22)} ERROR  ${String(e.message ?? e).slice(0,220)}`);
  }
}

for (const p of [1, 2, 4, 8]) {
  await sim(`v1 ${p} pair(s) = ${p*2} txn`, await buildV1(p));
}
try { await buildV1(9); } catch (e) { console.log(`v1 9 pairs             SDK: ${String(e.message).slice(0,90)}`); }
