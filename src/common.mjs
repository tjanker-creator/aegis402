// Shared config + helpers for AEGIS402 (testnet)
import algosdk from "algosdk";
import "dotenv/config";

export const ALGOD_URL = process.env.ALGOD_URL ?? "https://testnet-api.algonode.cloud";
export const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://facilitator.goplausible.xyz";
export const USDC_ASA_ID = Number(process.env.USDC_ASA_ID ?? 10458941);
export const TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
export const MIN_FEE = 1000;

export const algod = new algosdk.Algodv2("", ALGOD_URL, "");

export function account(role) {
  const mn = process.env[`${role}_MNEMONIC`];
  if (!mn) throw new Error(`${role}_MNEMONIC missing — run: node scripts/keygen.mjs`);
  const a = algosdk.mnemonicToSecretKey(mn.replace(/"/g, ""));
  return { addr: a.addr.toString(), sk: a.sk };
}

/** The facilitator's fee payer, read live from /supported (never hardcode). */
export async function facilitatorFeePayer() {
  const res = await fetch(`${FACILITATOR_URL}/supported`);
  if (!res.ok) throw new Error(`/supported ${res.status}`);
  const { kinds } = await res.json();
  const kind = kinds.find((k) => k.network === TESTNET_CAIP2 && k.scheme === "exact" && k.x402Version === 2);
  if (!kind?.extra?.feePayer) throw new Error("no AVM testnet feePayer advertised");
  return kind.extra.feePayer;
}

export const b64 = (u8) => Buffer.from(u8).toString("base64");

/** POST /verify or /settle against the hosted facilitator. */
export async function facilitator(path, paymentPayload, paymentRequirements) {
  const res = await fetch(`${FACILITATOR_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}

export function requirements({ amount, payTo, feePayer }) {
  return {
    scheme: "exact",
    network: TESTNET_CAIP2,
    amount: String(amount),
    asset: String(USDC_ASA_ID),
    payTo,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", decimals: 6, feePayer },
  };
}

export function payload(paymentGroup, paymentIndex) {
  return {
    x402Version: 2,
    scheme: "exact",
    network: TESTNET_CAIP2,
    payload: { paymentGroup, paymentIndex },
  };
}

export async function usdcBalance(addr) {
  try {
    const info = await algod.accountInformation(addr).do();
    const a = (info.assets ?? []).find((x) => Number(x.assetId ?? x["asset-id"]) === USDC_ASA_ID);
    return a ? BigInt(a.amount) : null; // null = not opted in
  } catch { return null; }
}

export const fmtUsdc = (micro) => (micro === null ? "not opted in" : `${(Number(micro) / 1e6).toFixed(6)} USDC`);
