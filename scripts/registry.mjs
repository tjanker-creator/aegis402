// Deploys the attestation registry and registers an attested payout address.
//
//   node scripts/registry.mjs deploy
//   node scripts/registry.mjs register [attestation.json]
//   node scripts/registry.mjs show
//
// Registering runs the whole verification on chain: the contract recomputes the
// digest, recovers the attestor from the signature, and only then records the
// address. If the signature is not the attestor's, the call fails.
import algosdk from "algosdk";
import { readFileSync, appendFileSync } from "node:fs";
import { ethers } from "ethers";
import { algod, account } from "../src/common.mjs";
import "dotenv/config";

const ATTESTOR = "0xdb736b13e2f522dbe18b2015d0291e4b193d8ef6";
const cmd = process.argv[2] ?? "show";
const owner = account("MERCHANT");

const hex = (h) => Buffer.from(h.replace(/^0x/, ""), "hex");
const utf8 = (s) => new TextEncoder().encode(s);

async function deploy() {
  const approval = readFileSync(new URL("../contracts/registry.teal", import.meta.url), "utf8")
    .replace("byte ATTESTOR_ADDR", `byte 0x${ATTESTOR.replace(/^0x/, "")}`)
    .replace(/^addr_check:\n/m, "");
  const clear = readFileSync(new URL("../contracts/clear.teal", import.meta.url), "utf8");
  const ap = Buffer.from((await algod.compile(approval).do()).result, "base64");
  const cp = Buffer.from((await algod.compile(clear).do()).result, "base64");
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: owner.addr, suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: ap, clearProgram: cp,
    numGlobalInts: 0, numGlobalByteSlices: 0, numLocalInts: 0, numLocalByteSlices: 0,
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(owner.sk)).do();
  const res = await algosdk.waitForConfirmation(algod, txid, 5);
  const appId = Number(res.applicationIndex ?? res["application-index"]);
  const appAddr = algosdk.getApplicationAddress(appId).toString();

  // boxes need the app account to cover their minimum balance
  const sp2 = await algod.getTransactionParams().do();
  const fund = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: owner.addr, receiver: appAddr, amount: 200000, suggestedParams: sp2,
  });
  const f = await algod.sendRawTransaction(fund.signTxn(owner.sk)).do();
  await algosdk.waitForConfirmation(algod, f.txid, 4);

  appendFileSync(".env", `\nREGISTRY_APP_ID=${appId}\n`);
  console.log(`registry appId ${appId}\napp account    ${appAddr}  (funded 0.2 ALGO for boxes)`);
  console.log(`attestor       ${ATTESTOR}`);
}

async function register(file) {
  const appId = Number(process.env.REGISTRY_APP_ID);
  if (!appId) throw new Error("REGISTRY_APP_ID missing — run: node scripts/registry.mjs deploy");
  const att = JSON.parse(readFileSync(file ?? "attestation.json", "utf8"));

  let acc = "0x";
  for (const r of att.reponseResolve) {
    acc = ethers.utils.solidityPack(["bytes", "string", "string", "string"], [acc, r.keyName, r.parseType, r.parsePath]);
  }
  const responseHash = ethers.utils.keccak256(acc);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(BigInt(att.timestamp));

  const args = [
    utf8("register"),
    hex(att.recipient),
    utf8(att.request.url),
    utf8(att.request.header),
    utf8(att.request.method),
    utf8(att.request.body),
    hex(responseHash),
    utf8(att.data),
    utf8(att.attConditions),
    ts,
    utf8(att.additionParams),
    hex(att.signatures[0]),
  ];

  const payTo = att.data.slice(10, 68);
  console.log(`registering ${payTo}`);
  console.log(`  attested from ${att.request.url}`);

  const sp = await algod.getTransactionParams().do();
  // ecdsa_pk_recover costs 2000 units; one app call carries 700, so pad the
  // group with cheap calls purely to raise the pooled opcode budget.
  const main = algosdk.makeApplicationNoOpTxnFromObject({
    sender: owner.addr, appIndex: appId, appArgs: args,
    boxes: [{ appIndex: appId, name: utf8(payTo) }],
    suggestedParams: sp,
  });
  // The pads exist only to raise the pooled opcode budget, so they must call a
  // permissive app — the registry itself rejects anything that is not a
  // registration.
  const padApp = Number(process.env.NOOP_APP_ID);
  const pads = [0, 1, 2].map((i) =>
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: owner.addr, appIndex: padApp, appArgs: [utf8("budget"), new Uint8Array([i])],
      suggestedParams: sp,
    }));
  const group = [main, ...pads];
  algosdk.assignGroupID(group);
  const signed = group.map((t) => t.signTxn(owner.sk));
  const { txid } = await algod.sendRawTransaction(signed).do();
  const res = await algosdk.waitForConfirmation(algod, txid, 5);
  console.log(`\nverified on chain and recorded — round ${res.confirmedRound ?? res["confirmed-round"]}`);
  console.log(`https://lora.algokit.io/testnet/transaction/${txid}`);
}

async function show() {
  const appId = Number(process.env.REGISTRY_APP_ID);
  const { boxes } = await algod.getApplicationBoxes(appId).do();
  console.log(`registry ${appId} — ${boxes.length} attested address(es)\n`);
  for (const b of boxes) {
    const name = Buffer.from(b.name).toString();
    const { value } = await algod.getApplicationBoxByName(appId, b.name).do();
    console.log(`  ${name}  attested at round ${Buffer.from(value).readBigUInt64BE()}`);
  }
}

if (cmd === "deploy") await deploy();
else if (cmd === "register") await register(process.argv[3]);
else await show();
