// Creates the MAINNET accounts. Keys are written to .env.mainnet, which is
// gitignored and never leaves this machine.
//
//   node scripts/mainnet-keygen.mjs
import algosdk from "algosdk";
import { writeFileSync, existsSync } from "node:fs";

const FILE = ".env.mainnet";
if (existsSync(FILE)) { console.error(`${FILE} already exists — delete it first if you really want new keys.`); process.exit(1); }

const ROLES = [
  ["AGENT", "the guarded agent wallet — holds the USDC that policy protects"],
  ["MERCHANT", "the allowlisted resource server — the only address the agent may pay"],
  ["TREASURY", "receives the guard fee"],
  ["OPERATOR", "signs guard calls, holds no funds"],
  ["ATTACKER", "never funded — used only to prove payments to it fail"],
];

const lines = [
  "# AEGIS402 MAINNET accounts — real funds. Never commit this file.",
  "MAINNET=1",
  "ALGOD_URL=https://mainnet-api.algonode.cloud",
  "INDEXER_URL=https://mainnet-idx.algonode.cloud",
  "USDC_ASA_ID=31566704",
  "FACILITATOR_URL=https://facilitator.goplausible.xyz",
  "",
];
const out = [];
for (const [role, desc] of ROLES) {
  const a = algosdk.generateAccount();
  lines.push(`# ${role}: ${desc}`, `${role}_ADDRESS=${a.addr}`, `${role}_MNEMONIC="${algosdk.secretKeyToMnemonic(a.sk)}"`, "");
  out.push([role, a.addr.toString()]);
}
writeFileSync(FILE, lines.join("\n"));

console.log("\nMAINNET accounts written to .env.mainnet (gitignored)\n");
for (const [r, a] of out) console.log(`${r.padEnd(9)} ${a}`);
console.log(`
Funding needed (small):
  AGENT     ~2 ALGO  +  ~15 USDC   <- the wallet the policy guards
  MERCHANT  ~1 ALGO                <- must opt in to USDC to receive
  TREASURY  ~0.5 ALGO              <- must opt in to USDC to receive the fee
  OPERATOR  ~0.5 ALGO              <- signs guard calls only

USDC on Algorand is ASA 31566704. Send ALGO first; opt-ins run afterwards.
`);
