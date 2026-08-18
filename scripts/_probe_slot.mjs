// READ-ONLY PROBE: builds the proposed 8-txn "slot" group and calls /verify ONLY.
// Never calls /settle. No funds move.
import "dotenv/config";
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import { ethers } from "ethers";
import { algod, account, USDC_ASA_ID, MIN_FEE, b64, facilitator, requirements, payload, facilitatorFeePayer } from "../src/common.mjs";

const GUARD    = Number(process.env.POLICY_APP_ID);
const REGISTRY = Number(process.env.REGISTRY_APP_ID);
const PAD      = Number(process.env.NOOP_APP_ID);
const merchantAddr = process.env.MERCHANT_ADDRESS;
const operator = account("OPERATOR");
const merchant = account("MERCHANT");
const attacker = account("ATTACKER");
const agent    = account("AGENT");
const vault    = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64, "base64"));
const utf8 = (s) => new TextEncoder().encode(s);
const hex  = (h) => Buffer.from(h.replace(/^0x/, ""), "hex");

function attestationArgs(file) {
  const att = JSON.parse(readFileSync(file, "utf8"));
  let acc = "0x";
  for (const r of att.reponseResolve)
    acc = ethers.utils.solidityPack(["bytes","string","string","string"],[acc,r.keyName,r.parseType,r.parsePath]);
  const ts = Buffer.alloc(8); ts.writeBigUInt64BE(BigInt(att.timestamp));
  return { payTo: att.data.slice(10,68), args: [utf8("register"), hex(att.recipient), utf8(att.request.url),
    utf8(att.request.header), utf8(att.request.method), utf8(att.request.body),
    hex(ethers.utils.keccak256(acc)), utf8(att.data), utf8(att.attConditions), ts,
    utf8(att.additionParams), hex(att.signatures[0])] };
}

async function build({ file="attestation.json", amount=20000, receiver=merchantAddr,
                       withConsent=true, withRegistry=true, badConsent=false, fill=0 }) {
  const { payTo, args } = attestationArgs(file);
  const feePayer = await facilitatorFeePayer();
  const sp = await algod.getTransactionParams().do();
  const zero = { ...sp, fee: 0, flatFee: true };
  const rows = [];
  rows.push({ kind:"feepayer" });
  rows.push({ kind:"guard" });
  if (withRegistry) rows.push({ kind:"registry" });
  rows.push({kind:"pad",i:0},{kind:"pad",i:1},{kind:"pad",i:2});
  if (withConsent) rows.push({ kind:"consent" });
  for (let k=0;k<fill;k++) rows.push({ kind:"pad", i:10+k });
  rows.push({ kind:"payment" });
  const payIdx = rows.length - 1;
  const size = rows.length;
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, BigInt(payIdx));

  const txns = rows.map((r) => {
    switch (r.kind) {
      case "feepayer": return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: feePayer, receiver: feePayer, amount: 0,
        suggestedParams: { ...sp, fee: MIN_FEE*size, flatFee: true } });
      case "guard": return algosdk.makeApplicationNoOpTxnFromObject({
        sender: operator.addr, appIndex: GUARD, appArgs:[idx], suggestedParams: zero });
      case "registry": return algosdk.makeApplicationNoOpTxnFromObject({
        sender: operator.addr, appIndex: REGISTRY, appArgs: args,
        boxes:[{ appIndex: REGISTRY, name: utf8(payTo) }], suggestedParams: zero });
      case "pad": return algosdk.makeApplicationNoOpTxnFromObject({
        sender: operator.addr, appIndex: PAD, appArgs:[utf8("budget"), new Uint8Array([r.i])],
        suggestedParams: zero });
      case "consent": return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: merchantAddr, receiver: merchantAddr, amount: 0, suggestedParams: zero });
      case "payment": return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: agent.addr, receiver, assetIndex: USDC_ASA_ID, amount, suggestedParams: zero });
    }
  });
  algosdk.assignGroupID(txns);
  const group = txns.map((t,i) => {
    if (rows[i].kind==="feepayer") return b64(algosdk.encodeUnsignedTransaction(t));
    if (rows[i].kind==="payment")  return b64(algosdk.signLogicSigTransactionObject(t, vault).blob);
    if (rows[i].kind==="consent")  return b64(t.signTxn(badConsent ? attacker.sk : merchant.sk));
    return b64(t.signTxn(operator.sk));
  });
  return { paymentPayload: payload(group, payIdx),
           paymentRequirements: requirements({ amount:String(amount), payTo:receiver, feePayer }),
           size, payIdx };
}

async function probe(name, opts) {
  const built = await build(opts);
  const r = await facilitator("/verify", built.paymentPayload, built.paymentRequirements);
  const b = r.body ?? {};
  const msg = (b.invalidMessage ?? b.error ?? JSON.stringify(b)).replace(/\s+/g," ");
  console.log(`${name.padEnd(24)} size=${String(built.size).padEnd(2)} payIdx=${String(built.payIdx).padEnd(2)} isValid=${b.isValid}`);
  console.log(`  ${b.isValid ? "OK" : (b.invalidReason ?? "?") + " :: " + msg.slice(0,260)}`);
  console.log();
}

await probe("full-stack-8",        {});
await probe("policy-violated",     { amount: 500000 });
await probe("provenance-forged",   { file: "attestation-forged.json" });
await probe("consent-withheld",    { badConsent: true });
await probe("ceiling-16",          { fill: 8 });
