import "dotenv/config";
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE, b64, facilitator, requirements, payload, facilitatorFeePayer } from "../src/common.mjs";
const merchantAddr=process.env.MERCHANT_ADDRESS;
const operator=account("OPERATOR");
const feePayer=await facilitatorFeePayer();
const sp=await algod.getTransactionParams().do();
// 17 trivially-built entries: just repeat a signed pad txn 17 times in the array.
const pad=algosdk.makeApplicationNoOpTxnFromObject({sender:operator.addr,appIndex:Number(process.env.NOOP_APP_ID),appArgs:[new TextEncoder().encode("x")],suggestedParams:{...sp,fee:0,flatFee:true}});
const g=Array(17).fill(b64(pad.signTxn(operator.sk)));
const r=await facilitator("/verify",payload(g,16),requirements({amount:"20000",payTo:merchantAddr,feePayer}));
console.log("RAW 17:", JSON.stringify(r.body));
console.log("HTTP:", r.status);
