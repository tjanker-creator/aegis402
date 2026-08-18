// AEGIS402 — guard v3: the proof is REQUIRED, not merely available.
//
// The guard enforces an allowlist. The obvious objection is: who put the
// address on it? Answering "we did" makes us the new trust anchor.
//
// So this battery puts the zkTLS registry call INSIDE the payment group. The
// group now settles only if, in the same atomic bundle:
//   - the guard approves the receiver and the amount, and
//   - an Algorand contract recovers a Primus attestor's secp256k1 signature
//     over the exact bytes the merchant's domain served, and that attestation
//     names the very address being paid.
// Swap the attestation for a forged one and the registry rejects, so the group
// dies and the payment cannot exist. No new contract: this is the guard-as-a-
// slot thesis pointed at provenance.
import "dotenv/config";
import { readFileSync } from "node:fs";
import algosdk from "algosdk";
import { ethers } from "ethers";
import { algod, account, USDC_ASA_ID, MIN_FEE, usdcBalance, fmtUsdc } from "../src/common.mjs";

const GUARD    = Number(process.env.GUARD3_APP_ID);
const REGISTRY = Number(process.env.REGISTRY_APP_ID);
const PAD      = Number(process.env.NOOP_APP_ID);
const merchant = process.env.MERCHANT_ADDRESS;
const operator = account("OPERATOR");
const agent    = { addr: process.env.V3_PAYER_ADDRESS };
const vault    = new algosdk.LogicSigAccount(Buffer.from(process.env.V3_VAULT_LSIG_B64, "base64"));

const utf8 = (s) => new TextEncoder().encode(s);
const hex  = (h) => Buffer.from(h.replace(/^0x/, ""), "hex");

function attestationArgs(file) {
  const att = JSON.parse(readFileSync(file, "utf8"));
  let acc = "0x";
  for (const r of att.reponseResolve)
    acc = ethers.utils.solidityPack(["bytes", "string", "string", "string"],
                                    [acc, r.keyName, r.parseType, r.parsePath]);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64BE(BigInt(att.timestamp));
  return {
    payTo: att.data.slice(10, 68),
    url: att.request.url,
    args: [utf8("register"), hex(att.recipient), utf8(att.request.url), utf8(att.request.header),
           utf8(att.request.method), utf8(att.request.body), hex(ethers.utils.keccak256(acc)),
           utf8(att.data), utf8(att.attConditions), ts, utf8(att.additionParams),
           hex(att.signatures[0])],
  };
}

/** [0] guard · [1] registry · [2..4] budget pads · [5] payment
    withAttestation=false drops the registry call, to test whether anything
    actually REQUIRES it to be there. */
async function build(file, amount, receiver, withAttestation = true) {
  const { payTo, args } = attestationArgs(file);
  const sp = await algod.getTransactionParams().do();
  const payIdx = withAttestation ? 5 : 4;
  const zero = { ...sp, fee: 0, flatFee: true };

  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, BigInt(payIdx));

  const txns = [
    algosdk.makeApplicationNoOpTxnFromObject({          // [0] the guard
      sender: operator.addr, appIndex: GUARD, appArgs: [idx],
      suggestedParams: { ...sp, fee: MIN_FEE * 6, flatFee: true },
    }),
    ...(withAttestation ? [algosdk.makeApplicationNoOpTxnFromObject({   // [1] the attestation
      sender: operator.addr, appIndex: REGISTRY, appArgs: args,
      boxes: [{ appIndex: REGISTRY, name: utf8(payTo) }],
      suggestedParams: zero,
    })] : []),
    ...[0, 1, 2].map((i) =>                             // [2..4] opcode budget
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: operator.addr, appIndex: PAD, appArgs: [utf8("budget"), new Uint8Array([i])],
        suggestedParams: zero,
      })),
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({   // [5] the payment
      sender: agent.addr, receiver, assetIndex: USDC_ASA_ID, amount,
      suggestedParams: zero,
    }),
  ];
  algosdk.assignGroupID(txns);
  return txns.map((t, i) =>
    i === payIdx ? algosdk.signLogicSigTransactionObject(t, vault).blob : t.signTxn(operator.sk));
}

const short = (m) => {
  const s = String(m).replace(/\s+/g, " ");
  const hit = s.match(/rejected by (ApprovalProgram|logic)[^,;]*/i) || s.match(/logic eval error[^,;]*/i);
  return (hit ? hit[0] : s).slice(0, 130);
};

async function run(name, why, file, amount, receiver, expect, withAttestation = true) {
  process.stdout.write(`  ${name.padEnd(26)}`);
  let outcome, detail;
  try {
    const { txid } = await algod.sendRawTransaction(await build(file, amount, receiver, withAttestation)).do();
    const r = await algosdk.waitForConfirmation(algod, txid, 5);
    outcome = "settled"; detail = `round ${r.confirmedRound ?? r["confirmed-round"]} · ${txid}`;
  } catch (e) { outcome = "blocked"; detail = short(e.message ?? e); }
  console.log(`${outcome === expect ? "PASS" : "FAIL"}  ${outcome}`);
  console.log(`        ${why}`);
  console.log(`        ${detail}`);
  return outcome === expect;
}

const { url, payTo } = attestationArgs("attestation.json");
console.log("AEGIS402 guard v3 — a payment that cannot show where its payee came from does not settle");
console.log(`guard ${GUARD} · registry ${REGISTRY} · vault ${vault.address()}\n`);
console.log(`  attested address  ${payTo}`);
console.log(`  witnessed at      ${url}`);
console.log(`  guard allowlist   ${merchant}`);
console.log(`  ${payTo === merchant ? "the address being paid IS the attested address" : "MISMATCH"}\n`);

const before = await usdcBalance(merchant);
const ok = [];
ok.push(await run("attested-payment", "Genuine Primus attestation rides in the payment group",
  "attestation.json", 20000, merchant, "settled"));
ok.push(await run("forged-attestation", "Payee swapped in the attestation, signature untouched",
  "attestation-forged.json", 20000, merchant, "blocked"));
ok.push(await run("attestation-omitted", "No registry call in the group — v1 settled this, v3 must not",
  "attestation.json", 20000, merchant, "blocked", false));
ok.push(await run("redirect-to-attacker", "Attested proof present, but the money sent elsewhere",
  "attestation.json", 20000, process.env.ATTACKER_ADDRESS, "blocked"));
ok.push(await run("over-the-cap", "Attested proof present, ten times the cap",
  "attestation.json", 500000, merchant, "blocked"));
const after = await usdcBalance(merchant);

console.log("\n" + "─".repeat(78));
console.log(`merchant balance  ${fmtUsdc(before)}  →  ${fmtUsdc(after)}`);
console.log(`${ok.filter(Boolean).length}/${ok.length} as expected — no proof of provenance, no payment`);
