// Opts AGENT + MERCHANT into the USDC ASA (required before any x402 payment can settle).
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, usdcBalance } from "../src/common.mjs";

for (const role of ["AGENT", "MERCHANT"]) {
  const { addr, sk } = account(role);
  if ((await usdcBalance(addr)) !== null) { console.log(`${role}: already opted in`); continue; }
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: addr, receiver: addr, assetIndex: USDC_ASA_ID, amount: 0, suggestedParams: sp,
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  console.log(`${role}: opted in to USDC (${txid})`);
}
console.log("\nDone. AGENT can now receive testnet USDC from https://faucet.circle.com");
