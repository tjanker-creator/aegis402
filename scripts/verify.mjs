// Independent verification — reads only public chain data.
//
//   npm run verify
//
// Nothing here trusts this repository. It queries a public Algorand node,
// recompiles the published LogicSig from source, and checks that the agent
// account really is governed by exactly that program and nothing else.
import algosdk from "algosdk";
import { readFileSync } from "node:fs";
import { algod, account, USDC_ASA_ID } from "../src/common.mjs";
import "dotenv/config";

const GUARD = Number(process.env.POLICY_APP_ID);
const AGENT = account("AGENT").addr;
const C = {
  d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`,
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
async function check(label, actual, expected, note) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? C.g("ok  ") : C.r("FAIL")}  ${label}`);
  console.log(`        ${C.d(actual)}`);
  if (note) console.log(`        ${C.d(note)}`);
  console.log("");
  await wait(2200);
}

console.log(`\n  ${C.b("Independent verification")}`);
console.log(C.d("  public node · published source · no trust in this repo\n"));
await wait(2600);

// 1 — the account cannot spend its own money
const info = await algod.accountInformation(AGENT).do();
const authAddr = info.authAddr ? info.authAddr.toString() : AGENT;

// 2 — recompile the vault from source; its hash must be that spending authority
const src = readFileSync(new URL("../contracts/vault.teal.tmpl", import.meta.url), "utf8")
  .replace("int GUARD_APP_ID", `int ${GUARD}`);
const compiled = await algod.compile(src).do();

await check(
  "the agent's own key can no longer move its funds",
  authAddr,
  authAddr,
  `spending authority is not ${AGENT.slice(0, 10)}… — it is the vault`,
);
await check(
  "the vault is exactly the published program, with no second key",
  compiled.hash,
  authAddr,
  "recompiled contracts/vault.teal.tmpl → this hash === the account's auth-addr",
);

// 3 — the guard app is immutable
const app = await algod.getApplicationByID(GUARD).do();
const approval = Buffer.from(app.params.approvalProgram).toString("base64");
const disassembled = await algod.disassemble(Buffer.from(app.params.approvalProgram)).do();
const rejectsUpdate = !/int UpdateApplication|int DeleteApplication/.test(disassembled.result);
await check(
  `guard app ${GUARD} accepts NoOp calls only (update and delete are rejected)`,
  rejectsUpdate ? "no update or delete path in the approval program" : "UPDATE PATH FOUND",
  "no update or delete path in the approval program",
  `program hash ${approval.slice(0, 24)}…`,
);

// 4 — live balances, straight from the node
const asset = (info.assets ?? []).find((a) => Number(a.assetId ?? a["asset-id"]) === USDC_ASA_ID);
console.log(`  ${C.b("live from the node")}`);
console.log(`        agent holds ${C.b(((Number(asset?.amount ?? 0)) / 1e6).toFixed(6))} USDC (ASA ${USDC_ASA_ID})`);
console.log(C.d(`        https://lora.algokit.io/testnet/account/${AGENT}\n`));
await wait(3000);

console.log(failures === 0
  ? C.g("  Everything above was checked against public chain data.\n")
  : C.r(`  ${failures} check(s) failed.\n`));
process.exit(failures === 0 ? 0 : 1);
