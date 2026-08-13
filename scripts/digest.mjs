// Reproduces the exact digest a Primus attestor signs, and recovers the signer
// from it. If this matches the advertised attestor address, the same steps can
// be done on-chain in TEAL — that is the whole bet.
//
//   node scripts/digest.mjs [attestation.json]
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const att = JSON.parse(readFileSync(process.argv[2] ?? "attestation.json", "utf8"));

// keccak256(abi.encodePacked(url, header, method, body))
const requestHash = ethers.utils.keccak256(ethers.utils.solidityPack(
  ["string", "string", "string", "string"],
  [att.request.url, att.request.header, att.request.method, att.request.body],
));

// keccak256(abi.encodePacked("0x", keyName, parseType, parsePath)) folded over each resolve
let acc = "0x";
for (const r of att.reponseResolve) {
  acc = ethers.utils.solidityPack(["bytes", "string", "string", "string"], [acc, r.keyName, r.parseType, r.parsePath]);
}
const responseHash = ethers.utils.keccak256(acc);

const packed = ethers.utils.solidityPack(
  ["address", "bytes32", "bytes32", "string", "string", "uint64", "string"],
  [att.recipient, requestHash, responseHash, att.data, att.attConditions, att.timestamp, att.additionParams],
);
const digest = ethers.utils.keccak256(packed);

// The attestor signs the raw digest — no EIP-191 prefix. That matters: it is
// one keccak256 less to do on chain.
const sig = att.signatures[0];
const recovered = ethers.utils.recoverAddress(digest, sig);
const expected = att.attestors[0].attestorAddr;
const ok = recovered.toLowerCase() === expected.toLowerCase();

console.log(`request hash    ${requestHash}`);
console.log(`response hash   ${responseHash}`);
console.log(`preimage bytes  ${(packed.length - 2) / 2}`);
console.log(`digest          ${digest}`);
console.log(`recovered       ${recovered}`);
console.log(`attestor says   ${expected}`);
console.log(`\n${ok ? "MATCH — the signature is reproducible from published fields" : "MISMATCH"}`);

if (ok) {
  // What TEAL will need. requestHash and responseHash are constant for a given
  // endpoint + resolve config, so they can live in global state rather than
  // being rebuilt on chain.
  console.log(`\nfor the contract:`);
  console.log(`  recipient        ${att.recipient}`);
  console.log(`  data             ${att.data}`);
  console.log(`  attConditions    ${att.attConditions}`);
  console.log(`  timestamp        ${att.timestamp}`);
  console.log(`  additionParams   ${att.additionParams}`);
  console.log(`  signature bytes  ${(sig.length - 2) / 2}  (r||s||v, v=${parseInt(sig.slice(-2), 16)})`);
}
process.exit(ok ? 0 : 1);
