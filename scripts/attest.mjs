// Asks a Primus attestor to witness that a merchant's own domain publishes a
// given Algorand payout address.
//
//   node scripts/attest.mjs <url> <jsonPath>
//
// The attestor joins the TLS session to that URL, reads the value at jsonPath,
// and signs a statement about it. What comes back is a signature we can verify
// on Algorand — the merchant never has to cooperate with us, and we never have
// to be trusted.
import { PrimusCoreTLS } from "@primuslabs/zktls-core-sdk";
import { writeFileSync } from "node:fs";
import "dotenv/config";

const url = process.argv[2] ?? "https://raw.githubusercontent.com/tjanker-creator/aegis402/main/.well-known/x402-payto.json";
const jsonPath = process.argv[3] ?? "$.payTo";

const appId = process.env.PRIMUS_APP_ID;
const appSecret = process.env.PRIMUS_APP_SECRET;
if (!appId || !appSecret) { console.error("PRIMUS_APP_ID / PRIMUS_APP_SECRET missing in .env"); process.exit(1); }

const zk = new PrimusCoreTLS();
const ready = await zk.init(appId, appSecret);
console.log(`primus init: ${ready}`);

const request = { url, method: "GET", header: {}, body: "" };
const responseResolves = [{ keyName: "payTo", parsePath: jsonPath, parseType: "string" }];

const params = zk.generateRequestParams(request, responseResolves);
params.setAttMode({ algorithmType: "proxytls" });

console.log(`asking an attestor to witness ${url} …`);
const started = Date.now();
const attestation = await zk.startAttestation(params);
console.log(`attested in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const valid = zk.verifyAttestation(attestation);
console.log(`local signature check: ${valid}`);

writeFileSync("attestation.json", JSON.stringify(attestation, null, 2));
console.log("\nwritten to attestation.json\n");
console.log("recipient   :", attestation.recipient);
console.log("attestors   :", (attestation.attestors ?? []).map((a) => a.attestorAddr).join(", "));
console.log("timestamp   :", attestation.timestamp);
console.log("data        :", attestation.data);
console.log("signatures  :", (attestation.signatures ?? []).length);
