// Shows funding / opt-in state of all three accounts.
import { algod, account, usdcBalance, fmtUsdc, facilitatorFeePayer, USDC_ASA_ID } from "../src/common.mjs";

const roles = ["AGENT", "MERCHANT", "ATTACKER"];
console.log(`\nAEGIS402 testnet status (USDC ASA ${USDC_ASA_ID})\n`);

let ready = true;
for (const role of roles) {
  const { addr } = account(role);
  let algo = 0n;
  try {
    const info = await algod.accountInformation(addr).do();
    algo = BigInt(info.amount);
  } catch { /* unfunded accounts 404 */ }
  const usdc = await usdcBalance(addr);
  const needsAlgo = role !== "ATTACKER" && algo < 200000n;
  const needsUsdc = role === "AGENT" && (usdc === null || usdc === 0n);
  if (needsAlgo || needsUsdc) ready = false;
  console.log(
    `${role.padEnd(9)} ${addr}\n` +
    `          ALGO: ${(Number(algo) / 1e6).toFixed(6)}   USDC: ${fmtUsdc(usdc)}` +
    `${needsAlgo ? "   <-- NEEDS ALGO" : ""}${needsUsdc ? "   <-- NEEDS USDC" : ""}\n`
  );
}

console.log(`facilitator feePayer: ${await facilitatorFeePayer()}`);
console.log(ready ? "\nREADY.\n" : "\nNOT READY — fund the accounts flagged above.\n  ALGO: https://lora.algokit.io/testnet/fund\n  USDC: https://faucet.circle.com (Algorand Testnet)\n");
