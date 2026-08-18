import "dotenv/config";
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import { ethers } from "ethers";
import { algod, account, USDC_ASA_ID, MIN_FEE, b64, facilitator, requirements, payload, facilitatorFeePayer } from "../src/common.mjs";
const GUARD=Number(process.env.POLICY_APP_ID), REGISTRY=Number(process.env.REGISTRY_APP_ID), PAD=Number(process.env.NOOP_APP_ID);
const merchantAddr=process.env.MERCHANT_ADDRESS;
const operator=account("OPERATOR"), merchant=account("MERCHANT"), agent=account("AGENT");
const vault=new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64,"base64"));
const utf8=(s)=>new TextEncoder().encode(s), hex=(h)=>Buffer.from(h.replace(/^0x/,""),"hex");
function attestationArgs(file){const att=JSON.parse(readFileSync(file,"utf8"));let acc="0x";
 for(const r of att.reponseResolve)acc=ethers.utils.solidityPack(["bytes","string","string","string"],[acc,r.keyName,r.parseType,r.parsePath]);
 const ts=Buffer.alloc(8);ts.writeBigUInt64BE(BigInt(att.timestamp));
 return{payTo:att.data.slice(10,68),args:[utf8("register"),hex(att.recipient),utf8(att.request.url),utf8(att.request.header),utf8(att.request.method),utf8(att.request.body),hex(ethers.utils.keccak256(acc)),utf8(att.data),utf8(att.attConditions),ts,utf8(att.additionParams),hex(att.signatures[0])]};}

async function build({omitGuard=false, fill=0}={}){
  const {payTo,args}=attestationArgs("attestation.json");
  const feePayer=await facilitatorFeePayer(); const sp=await algod.getTransactionParams().do();
  const zero={...sp,fee:0,flatFee:true};
  const rows=[{kind:"feepayer"}];
  if(!omitGuard) rows.push({kind:"guard"});
  rows.push({kind:"registry"},{kind:"pad",i:0},{kind:"pad",i:1},{kind:"pad",i:2},{kind:"consent"});
  for(let k=0;k<fill;k++) rows.push({kind:"pad",i:10+k});
  rows.push({kind:"payment"});
  const payIdx=rows.length-1, size=rows.length;
  const idx=new Uint8Array(8); new DataView(idx.buffer).setBigUint64(0,BigInt(payIdx));
  const txns=rows.map(r=>{switch(r.kind){
    case"feepayer":return algosdk.makePaymentTxnWithSuggestedParamsFromObject({sender:feePayer,receiver:feePayer,amount:0,suggestedParams:{...sp,fee:MIN_FEE*size,flatFee:true}});
    case"guard":return algosdk.makeApplicationNoOpTxnFromObject({sender:operator.addr,appIndex:GUARD,appArgs:[idx],suggestedParams:zero});
    case"registry":return algosdk.makeApplicationNoOpTxnFromObject({sender:operator.addr,appIndex:REGISTRY,appArgs:args,boxes:[{appIndex:REGISTRY,name:utf8(payTo)}],suggestedParams:zero});
    case"pad":return algosdk.makeApplicationNoOpTxnFromObject({sender:operator.addr,appIndex:PAD,appArgs:[utf8("budget"),new Uint8Array([r.i])],suggestedParams:zero});
    case"consent":return algosdk.makePaymentTxnWithSuggestedParamsFromObject({sender:merchantAddr,receiver:merchantAddr,amount:0,suggestedParams:zero});
    case"payment":return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({sender:agent.addr,receiver:merchantAddr,assetIndex:USDC_ASA_ID,amount:20000,suggestedParams:zero});}});
  algosdk.assignGroupID(txns);
  const group=txns.map((t,i)=>{const k=rows[i].kind;
    if(k==="feepayer")return b64(algosdk.encodeUnsignedTransaction(t));
    if(k==="payment")return b64(algosdk.signLogicSigTransactionObject(t,vault).blob);
    if(k==="consent")return b64(t.signTxn(merchant.sk));
    return b64(t.signTxn(operator.sk));});
  return {group,payIdx,size,feePayer};
}
async function show(name,{group,payIdx,size,feePayer}){
  const r=await facilitator("/verify",payload(group,payIdx),requirements({amount:"20000",payTo:merchantAddr,feePayer}));
  const b=r.body??{};
  console.log(`${name.padEnd(20)} size=${size} isValid=${b.isValid}`);
  console.log(`  ${b.isValid?"OK":(b.invalidReason??"?")+" :: "+String(b.invalidMessage??"").replace(/\s+/g," ").slice(0,300)}\n`);
}
await show("guard-omitted", await build({omitGuard:true}));
// ceiling-17: Algorand itself caps a group at 16, so a 17th entry can only be
// presented as a 17-element payload array. See what the facilitator says.
const b16=await build({fill:8});
const seventeen={...b16, group:[...b16.group, b16.group[3]], size:17};
await show("ceiling-17", seventeen);
