import "dotenv/config";
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE } from "../src/common.mjs";
const GUARD2 = Number(process.env.GUARD2_APP_ID);
const CAP = Number(process.env.CAP_MICRO ?? 50000);
const payer = account("MERCHANT");       // v2 battery uses MERCHANT as payer
const agent = account("AGENT");
const operator = account("OPERATOR");
const receiver = agent.addr;             // fee-test pays AGENT
const treasury = process.env.TREASURY_ADDRESS;
const vault = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64,"base64"));
const idx=(n)=>{const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,BigInt(n));return b;};

// v2 shape, N payment-pairs. [2j]=guard2 call(args pay,fee) [2j+1]=payment ; one shared fee txn appended
async function buildV2(pairs){
  const sp = await algod.getTransactionParams().do();
  const total = pairs*2+1;
  const txns=[]; const feeIdx = total-1;
  for(let j=0;j<pairs;j++){
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender:payer.addr, appIndex:GUARD2, appArgs:[idx(2*j+1), idx(feeIdx)],
      suggestedParams:{...sp, fee: j===0?MIN_FEE*total:0, flatFee:true}}));
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender:payer.addr, receiver, assetIndex:USDC_ASA_ID, amount:CAP,
      note:new TextEncoder().encode("pay-"+j),
      suggestedParams:{...sp, fee:0, flatFee:true}}));
  }
  txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender:payer.addr, receiver:treasury, assetIndex:USDC_ASA_ID, amount:5000,
    note:new TextEncoder().encode("guard-fee"),
    suggestedParams:{...sp, fee:0, flatFee:true}}));
  algosdk.assignGroupID(txns);
  return txns.map(t=>t.signTxn(payer.sk));
}

// the v1 AGENT vault asked to accept a guard-v2 call instead
async function buildCross(pairs){
  const sp = await algod.getTransactionParams().do();
  const total = pairs*2;
  const txns=[];
  for(let j=0;j<pairs;j++){
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender:operator.addr, appIndex:GUARD2, appArgs:[idx(2*j+1), idx(2*j+1)],
      suggestedParams:{...sp, fee:j===0?MIN_FEE*total:0, flatFee:true}}));
    txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender:agent.addr, receiver:process.env.MERCHANT_ADDRESS, assetIndex:USDC_ASA_ID, amount:CAP,
      note:new TextEncoder().encode("pay-"+j),
      suggestedParams:{...sp, fee:0, flatFee:true}}));
  }
  algosdk.assignGroupID(txns);
  return txns.map((t,i)=> i%2===1 ? algosdk.signLogicSigTransactionObject(t,vault).blob : t.signTxn(operator.sk));
}

async function sim(label, signed){
  try{
    const r = await algod.simulateRawTransactions(signed).do();
    const g = r.txnGroups[0];
    console.log(`${label.padEnd(30)} ${g.failureMessage ? "REJECTED  "+String(g.failureMessage).slice(0,140) : "WOULD SETTLE"}`);
  }catch(e){ console.log(`${label.padEnd(30)} ERROR ${String(e.message??e).slice(0,200)}`);}
}
await sim("v2  1 pair (+fee)  3 txn", await buildV2(1));
await sim("v2  2 pairs (+fee) 5 txn", await buildV2(2));
await sim("v2  7 pairs (+fee) 15 txn", await buildV2(7));
await sim("v1-vault + guard-v2 8 pairs", await buildCross(8));
