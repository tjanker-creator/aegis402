// Fallback only: mints a local test ASA so the harness can run end-to-end
// without waiting on the Circle faucet. The facilitator validates the asset id
// against the payment requirements, so any ASA exercises the identical code
// path. Real testnet USDC (ASA 10458941) is preferred whenever available.
import algosdk from "algosdk";
import { appendFileSync } from "node:fs";
import { algod, account } from "../src/common.mjs";

const { addr, sk } = account("AGENT");
const merchant = account("MERCHANT");
const sp = await algod.getTransactionParams().do();

const create = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
  sender: addr, total: 1_000_000_000, decimals: 6, defaultFrozen: false,
  unitName: "tUSDC", assetName: "AEGIS test USDC", manager: addr, reserve: addr,
  suggestedParams: sp,
});
const { txid } = await algod.sendRawTransaction(create.signTxn(sk)).do();
const res = await algosdk.waitForConfirmation(algod, txid, 5);
const asaId = Number(res.assetIndex ?? res["asset-index"]);
console.log(`minted fallback ASA ${asaId}`);

// merchant must opt in to receive it
const sp2 = await algod.getTransactionParams().do();
const optin = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
  sender: merchant.addr, receiver: merchant.addr, assetIndex: asaId, amount: 0, suggestedParams: sp2,
});
const r2 = await algod.sendRawTransaction(optin.signTxn(merchant.sk)).do();
await algosdk.waitForConfirmation(algod, r2.txid, 4);
console.log("merchant opted in");

appendFileSync(".env", `FALLBACK_ASA_ID=${asaId}\n`);
console.log(`\nTo use it:  USDC_ASA_ID=${asaId} npm run attack`);
