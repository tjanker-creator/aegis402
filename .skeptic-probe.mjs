// READ-ONLY: algod simulate of the proposed 6-txn x402 attested group. No submission.
import "dotenv/config";
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import { ethers } from "ethers";
import { algod, account, USDC_ASA_ID, MIN_FEE, facilitatorFeePayer } from "/Users/tj/aegis402/src/common.mjs";

const GUARD    = Number(process.env.POLICY_APP_ID);
const REGISTRY = Number(process.env.REGISTRY_APP_ID);
const PAD      = Number(process.env.NOOP_APP_ID);
const merchant = process.env.MERCHANT_ADDRESS;
const attacker = process.env.ATTACKER_ADDRESS;
const operator = account("OPERATOR");
const agent    = account("AGENT");
const vault    = new algosdk.LogicSigAccount(Buffer.from(process.env.VAULT_LSIG_B64, "base64"));
const utf8 = (s) => new TextEncoder().encode(s);
const hex  = (h) => Buffer.from(h.replace(/^0x/, ""), "hex");

function attestationArgs(file) {
  const att = JSON.parse(readFileSync("/Users/tj/aegis402/" + file, "utf8"));
  let acc = "0x";
  for (const r of att.reponseResolve)
    acc = ethers.utils.solidityPack(["bytes","string","string","string"],[acc,r.keyName,r.parseType,r.parsePath]);
  const ts = Buffer.alloc(8); ts.writeBigUInt64BE(BigInt(att.timestamp));
  return { payTo: att.data.slice(10,68), url: att.request.url,
    args: [utf8("register"), hex(att.recipient), utf8(att.request.url), utf8(att.request.header),
           utf8(att.request.method), utf8(att.request.body), hex(ethers.utils.keccak256(acc)),
           utf8(att.data), utf8(att.attConditions), ts, utf8(att.additionParams), hex(att.signatures[0])] };
}

const feePayer = await facilitatorFeePayer();
console.log("facilitator feePayer :", feePayer);
const sp = await algod.getTransactionParams().do();
const zero = { ...sp, fee: 0, flatFee: true };

async function build({ file, pads, amount = 20000, receiver = merchant, withFeePayer = true }) {
  const { args, payTo } = attestationArgs(file);
  const nPads = pads;
  const size = (withFeePayer ? 1 : 0) + 2 + nPads + 1;
  const payIdx = size - 1;
  const idx = new Uint8Array(8); new DataView(idx.buffer).setBigUint64(0, BigInt(payIdx));
  const txns = [];
  if (withFeePayer) txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: feePayer, receiver: feePayer, amount: 0, note: utf8("x402-fee-payer"),
    suggestedParams: { ...sp, fee: MIN_FEE * size, flatFee: true } }));
  txns.push(algosdk.makeApplicationNoOpTxnFromObject({ sender: operator.addr, appIndex: GUARD,
    appArgs: [idx], suggestedParams: withFeePayer ? zero : { ...sp, fee: MIN_FEE*size, flatFee:true } }));
  txns.push(algosdk.makeApplicationNoOpTxnFromObject({ sender: operator.addr, appIndex: REGISTRY,
    appArgs: args, boxes: [{ appIndex: REGISTRY, name: utf8(payTo) }], suggestedParams: zero }));
  for (let i = 0; i < nPads; i++) txns.push(algosdk.makeApplicationNoOpTxnFromObject({
    sender: operator.addr, appIndex: PAD, appArgs: [utf8("budget"), new Uint8Array([i])], suggestedParams: zero }));
  txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: agent.addr,
    receiver, assetIndex: USDC_ASA_ID, amount, note: utf8("x402-payment-v2"), suggestedParams: zero }));
  algosdk.assignGroupID(txns);
  const stxns = txns.map((t,i) => {
    if (withFeePayer && i === 0) return new algosdk.SignedTransaction({ txn: t });
    if (i === payIdx) return algosdk.decodeSignedTransaction(algosdk.signLogicSigTransactionObject(t, vault).blob);
    return algosdk.decodeSignedTransaction(t.signTxn(operator.sk));
  });
  return { stxns, size, payIdx };
}

async function sim(name, opts) {
  const { stxns, size, payIdx } = await build(opts);
  const req = new algosdk.modelsv2.SimulateRequest({
    txnGroups: [ new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: stxns }) ],
    allowEmptySignatures: true, allowMoreLogging: true,
  });
  try {
    const r = await algod.simulateTransactions(req).do();
    const g = r.txnGroups[0];
    const budget = g.appBudgetAdded !== undefined ? `budget added ${g.appBudgetAdded} consumed ${g.appBudgetConsumed}` : "";
    if (g.failureMessage) console.log(`${name.padEnd(34)} BLOCKED   ${String(g.failureMessage).replace(/\s+/g," ").slice(0,170)}  | ${budget}`);
    else console.log(`${name.padEnd(34)} WOULD SETTLE (size ${size}, payIdx ${payIdx})  | ${budget}`);
  } catch (e) {
    console.log(`${name.padEnd(34)} ERROR     ${String(e.message ?? e).replace(/\s+/g," ").slice(0,220)}`);
  }
}

await sim("PROPOSED genuine 6txn 2pads",   { file: "attestation.json", pads: 2 });
await sim("PROPOSED forged  6txn 2pads",   { file: "attestation-forged.json", pads: 2 });
await sim("control  genuine 6txn 1pad",    { file: "attestation.json", pads: 1 });
await sim("control  genuine 7txn 3pads",   { file: "attestation.json", pads: 3 });
await sim("control  genuine noFeePayer2p", { file: "attestation.json", pads: 2, withFeePayer: false });
