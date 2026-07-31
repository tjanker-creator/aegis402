# AEGIS402 — a spending firewall that lives in the ledger

**An AI agent's reasoning layer is also its payment-authorization layer. One
poisoned instruction and the wallet is empty.** AEGIS402 moves the spending
policy out of the agent and into the Algorand transaction group, so a
jailbroken agent can *decide* to overspend and the payment still cannot exist.

The mechanism, in one paragraph: the x402 AVM facilitator does not whitelist
transaction types. It validates the payment transfer at `paymentIndex` and its
own fee transaction, forbids `keyreg` / in-group `rekeyTo` / close-outs across
the group, and hands the **whole group** to `algod simulate`, accepting it only
if simulate reports no failure. So a client-signed policy application call can
ride in the same atomic group as the payment. If the policy rejects, simulate
fails, `/settle` never submits, and no funds move — enforcement as a property
of the ledger rather than of middleware. No facilitator fork, no protocol
change, and because the facilitator's fee-payer transaction pools the fee for
the entire group, **the guard costs the paying agent nothing**.

```
  x402 payment group, guarded
  ┌──────────────────────────────────────────────────────────────┐
  │ [0] fee-payer pay      unsigned, facilitator signs at settle  │
  │ [1] policy app-call    client-signed  ← AEGIS402 adds this    │
  │ [2] payment axfer      client-signed  ← paymentIndex          │
  └──────────────────────────────────────────────────────────────┘
        policy rejects → simulate fails → group dies → 0 USDC moves
```

## The proof

Everything below is on Algorand TestNet, settled through the **live hosted
GoPlausible facilitator** — not a local mock.

**A policy-compliant payment settles:**
[`256SCA6TQLIWGL2MLN555X6XVZ6C5ZQBGZNICYWCTBWHIVELCEUA`](https://lora.algokit.io/testnet/transaction/256SCA6TQLIWGL2MLN555X6XVZ6C5ZQBGZNICYWCTBWHIVELCEUA)
— 0.01 USDC moves.

**The same payment over the policy cap cannot exist:**
> `Transaction simulation failed: transaction P4QQ4SBG5XQ4U3OTIZVQ4ZJKOF3MJAGK4YMJZ5ETVSRW74ZTQKZA: transaction rejected by ApprovalProgram`

No transaction id, because there is no transaction. Agent balance delta: zero.
The only difference between the two runs is one client-signed application call
in the same atomic group.

**5 attacks blocked on-chain, 1 deliberately not blocked, 0 unexpected** —
full table with verbatim facilitator responses in [PROOF.md](PROOF.md).

Run it yourself:

```bash
npm install
npm run status     # account funding / opt-in state
npm run attack     # the full battery against the live facilitator
```

## What it does and does not do

`npm run attack` prints green rows for blocked attacks **and red rows for
attacks that succeed**. The red rows are the point. See
[KNOWN_BYPASSES.md](KNOWN_BYPASSES.md) — most importantly: the ledger gates the
*payment*, not the off-chain *action*, and in this build an agent that holds
its own key can still omit the guard. The vault design that closes that hole
(account rekeyed to an immutable LogicSig that refuses to sign without the
bound policy call) is specified and is the next milestone.

## Why Algorand and not somewhere else

On an account-based chain with EIP-3009-style transfers you sign *a payment*.
On Algorand you sign *a group*, and the group either commits entirely or not at
all. That is what lets a security check and a payment share one indivisible
outcome, with no escrow contract holding funds and no session-key
infrastructure. ERC-4337 session keys and account abstraction can express
similar policies on EVM — the difference is that here it is a property of the
base layer, expressible in a few lines of TEAL, and it composes with an
unmodified x402 facilitator.

## Layout

```
contracts/policy.teal   immutable Deadbolt policy: cap + receiver allowlist
src/aegis.mjs           builds the guarded payment group (the whole thesis)
src/server.mjs          a plain x402 merchant, unmodified, to pay against
scripts/attack.mjs      falsification harness — green and red rows
scripts/deploy.mjs      deploys the policy app (immutable: no update/delete)
KNOWN_BYPASSES.md       what this does not protect against
SPEC-NOTE.md            the facilitator invariant this relies on, in detail
```

## Status

TestNet only. Not audited. Built for the Algorand x402 Hackathon 2026.
