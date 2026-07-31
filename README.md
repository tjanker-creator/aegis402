# AEGIS402 — guards for x402 payments on Algorand

**An AI agent's reasoning layer is also its payment-authorization layer. One
poisoned instruction and the wallet is empty.** AEGIS402 moves the spending
policy out of the agent and into the Algorand transaction group, so a jailbroken
agent can *decide* to overspend and the payment still cannot exist.

```
  a guarded x402 payment — one atomic group, one fate
  ┌──────────────────────────────────────────────────────────────────┐
  │ [0] fee-payer          unsigned  → facilitator signs at settle    │
  │ [1] guard app-call     operator key  → policy: cap + allowlist    │
  │ [2] payment axfer      vault LogicSig → paymentIndex              │
  └──────────────────────────────────────────────────────────────────┘
     guard rejects → simulate fails → /settle never submits → 0 USDC moves
     guard missing → the vault refuses to sign at all
```

Three parts, each doing one job:

* **Vault** — a LogicSig the agent account is rekeyed to. It signs an outgoing
  transfer **only if** a call to its bound guard application, naming that
  transfer's own group index, is in the same group. This is what makes the guard
  unskippable rather than advisory.
* **Guard** — an immutable application that reads the payment via `gtxns` and
  approves or rejects it. Ours enforces a per-payment cap and a receiver
  allowlist. Yours can enforce anything.
* **Operator key** — signs the guard call and holds no money. If it leaks, the
  attacker gains the ability to *ask for permission*, and nothing else.

The facilitator is **unmodified**. Its fee-payer transaction pools the fee for
the whole group, so the guard costs the paying agent nothing.

## Proof

Live on TestNet through the hosted GoPlausible facilitator, 2026-07-31:

**Policy-compliant payment settles** —
[`QDARLDWMI7UYWV25MIKMYZFJV3IBCAK23KYYHV3WIQIBQ4LUONPQ`](https://lora.algokit.io/testnet/transaction/QDARLDWMI7UYWV25MIKMYZFJV3IBCAK23KYYHV3WIQIBQ4LUONPQ),
0.01 USDC moves.

**Same payment over the cap cannot exist** —
`transaction rejected by ApprovalProgram`, no transaction id, balance delta zero.

**8 attack scenarios, 7 blocked on-chain, 0 unexpected** — including *omit the
guard* and *substitute your own permissive guard*, both refused by the vault.
Full table with verbatim chain responses: [PROOF.md](PROOF.md).

```bash
npm install
npm run status     # funding / opt-in state
npm run attack     # the full battery against the live facilitator
npm run demo       # the story, paced for watching
```

## What this is not

The ledger gates the **payment**, not the off-chain **action**: a fully
compromised agent can still do unpaid damage. Policy correctness is yours to get
right. Nothing here is audited. The complete list is in
[KNOWN_BYPASSES.md](KNOWN_BYPASSES.md), and `npm run attack` is built to print
red rows when something is not blocked.

## Prior work, and what is actually ours

We are not claiming the primitive. An application call inspecting sibling
transactions in an atomic group and vetoing a transfer is long-standing Algorand
practice, and the x402 AVM scheme explicitly permits extra transactions in the
payment group — `paymentIndex` exists precisely because the group was expected
to contain more than the payment. GoPlausible's own documentation describes
adding "smart contract calls" to the `paymentGroup` for "conditional payments",
and the Algorand Foundation markets atomic grouping as letting "payments,
authorization, and usage logic settle together".

Related work enforces the same intent elsewhere: **KirkeLabs/oaa-agent-kit**
constrains an Algorand x402 agent through a LogicSig mandate;
**karangoraniya/agent-budget** implements on-chain spending policy over
`@x402-avm`; **Akita** ships ARC-58 plugins with spending allowances;
**Nevermined** and ERC-4337 session-key policies do the equivalent on EVM via
smart accounts.

What we contribute is narrower and, we think, useful: a **guard that travels
inside the payment group itself**, verified end-to-end against a live
third-party facilitator, combined with a vault that makes the guard impossible
to omit or substitute — so the payer keeps an ordinary Algorand account holding
ordinary USDC, with no asset wrapping, no custody, no smart-account migration
and no facilitator changes. We searched the x402 spec repository, the Algorand
and GoPlausible ecosystems and a large number of public x402 policy projects and
did not find that specific composition published; we would genuinely like to be
pointed at it if it exists.

See [SPEC-NOTE.md](SPEC-NOTE.md) for the facilitator behaviour this relies on and
one open question for its operators.

## Layout

```
contracts/vault.teal.tmpl   the LogicSig that makes the guard unskippable
contracts/policy.teal       the guard: cap + receiver allowlist, immutable
src/aegis.mjs               builds the guarded payment group
src/agent.mjs               a real LLM agent with a real payment tool
src/server.mjs              a plain, unmodified x402 merchant to pay against
scripts/attack.mjs          falsification harness
scripts/vault-setup.mjs     compiles the vault and rekeys the agent account
PROOF.md · KNOWN_BYPASSES.md · SPEC-NOTE.md
```

TestNet only. Not audited. Built for the Algorand x402 Hackathon, July 2026.
