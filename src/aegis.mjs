// AEGIS402 core: build a GUARDED x402 payment group.
//
// The whole thesis in one function. A normal x402 AVM payment group is
//   [0] facilitator fee-payer (unsigned)   [1] payment axfer (client-signed)
// AEGIS402 injects a client-signed policy app-call into the SAME group:
//   [0] fee-payer (unsigned)  [1] policy app-call  [2] payment axfer
// The facilitator does not whitelist transaction types — it validates the
// payment txn and its own fee txn, then hands the WHOLE group to algod
// simulate. So if the policy app rejects, simulate fails, /settle never
// submits, and the payment cannot exist. Enforcement becomes a ledger
// property instead of middleware.
import algosdk from "algosdk";
import { algod, account, USDC_ASA_ID, MIN_FEE, b64, facilitator, requirements, payload, facilitatorFeePayer } from "./common.mjs";

/**
 * @param {object} o
 * @param {bigint|number} o.amount      payment amount in microUSDC
 * @param {string} o.receiver           who gets paid
 * @param {number|null} o.guardAppId    policy app to call in-group; null = unguarded
 * @param {string} [o.rekeyTo]          attacker flag: try to smuggle a rekey
 * @param {boolean} [o.closeOut]        attacker flag: try to smuggle a close-out
 */
export async function buildGuardedGroup({ amount, receiver, guardAppId, rekeyTo, closeOut }) {
  const agent = account("AGENT");
  const feePayer = await facilitatorFeePayer();
  const sp = await algod.getTransactionParams().do();

  const guarded = guardAppId !== null && guardAppId !== undefined;
  const size = guarded ? 3 : 2;
  const paymentIndex = guarded ? 2 : 1;

  // The facilitator's fee-payer transaction pools the fee for the entire group,
  // so the agent pays zero ALGO — security at zero marginal cost to the payer.
  const feeParams = { ...sp, fee: MIN_FEE * size, flatFee: true };
  const zeroFee = { ...sp, fee: 0, flatFee: true };

  const txns = [];

  txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: feePayer, receiver: feePayer, amount: 0,
    note: new TextEncoder().encode("x402-fee-payer"),
    suggestedParams: feeParams,
  }));

  // The guard call is signed by the OPERATOR key (which holds no funds), not by
  // the vault — the vault's whole job is to refuse to sign anything except a
  // transfer accompanied by such a call.
  const operator = process.env.OPERATOR_MNEMONIC ? account("OPERATOR") : agent;
  if (guarded) {
    const idx = new Uint8Array(8);
    new DataView(idx.buffer).setBigUint64(0, BigInt(paymentIndex));
    txns.push(algosdk.makeApplicationNoOpTxnFromObject({
      sender: operator.addr, appIndex: Number(guardAppId), appArgs: [idx],
      suggestedParams: zeroFee,
    }));
  }

  txns.push(algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: agent.addr, receiver, assetIndex: USDC_ASA_ID, amount: Number(amount),
    note: new TextEncoder().encode("x402-payment-v2"),
    suggestedParams: zeroFee,
    ...(rekeyTo ? { rekeyTo } : {}),
    ...(closeOut ? { closeRemainderTo: closeOut } : {}),
  }));

  algosdk.assignGroupID(txns);

  // If the agent account has been rekeyed to the vault LogicSig, the agent's
  // own key can no longer authorise a transfer — the LogicSig signs it, and it
  // only does so when the bound guard call is present in this very group.
  const vaultB64 = process.env.VAULT_LSIG_B64;
  const vault = vaultB64
    ? new algosdk.LogicSigAccount(Buffer.from(vaultB64, "base64"))
    : null;

  const group = txns.map((t, i) => {
    if (i === 0) return b64(algosdk.encodeUnsignedTransaction(t)); // facilitator signs
    if (i === paymentIndex) {
      return vault
        ? b64(algosdk.signLogicSigTransactionObject(t, vault).blob) // vault authorises
        : b64(t.signTxn(agent.sk));
    }
    return b64(t.signTxn(operator.sk)); // guard call: operational key
  });

  return {
    paymentPayload: payload(group, paymentIndex),
    paymentRequirements: requirements({ amount: String(amount), payTo: receiver, feePayer }),
    groupSize: size,
  };
}

/**
 * The facilitator relays algod's raw rejection, which can carry a full
 * transaction dump. Keep the part that says WHY.
 */
export function condense(reason = "") {
  const m =
    reason.match(/rejected by logic err=[^.]*/) ??
    reason.match(/transaction rejected by ApprovalProgram/) ??
    reason.match(/(Rekey|Close-to) transactions are not allowed[^:]*: [^\n]*/) ??
    reason.match(/should have been authorized by \S+/);
  if (m) return m[0].trim();
  return reason.length > 200 ? reason.slice(0, 200) + "…" : reason;
}

/** Runs the full x402 handshake against the hosted facilitator. */
export async function verifyAndSettle(built) {
  const { paymentPayload, paymentRequirements } = built;
  const verify = await facilitator("/verify", paymentPayload, paymentRequirements);
  const isValid = verify.body?.isValid === true;
  if (!isValid) {
    return {
      blocked: true, stage: "verify",
      reason: verify.body?.invalidReason ?? verify.body?.error ?? JSON.stringify(verify.body),
    };
  }
  const settle = await facilitator("/settle", paymentPayload, paymentRequirements);
  if (settle.body?.success === true) {
    return { blocked: false, stage: "settle", txId: settle.body.transaction };
  }
  return {
    blocked: true, stage: "settle",
    reason: settle.body?.errorReason ?? settle.body?.error ?? JSON.stringify(settle.body),
  };
}
