# Proof

Recorded 2026-07-31 on **Algorand TestNet**, settled through the **live hosted
GoPlausible facilitator** at `https://facilitator.goplausible.xyz` — an
unmodified third-party service, not a local mock.

| | |
|---|---|
| Agent account (vault) | [`DORZEEZDH73RWH7ETRTVBMDECSA7JT5ZU6IFAFTOFHTSB3O33F3WCWXOXI`](https://lora.algokit.io/testnet/account/DORZEEZDH73RWH7ETRTVBMDECSA7JT5ZU6IFAFTOFHTSB3O33F3WCWXOXI) |
| Rekeyed to vault LogicSig | `BENS63EQYQ4T6IJPAOAJSXXHEYV72W6OWFHGPFPQTRJ7HQXDOD32OLULGM` |
| Guard app (immutable) | [`768360225`](https://lora.algokit.io/testnet/application/768360225) |
| Policy | max 50000 microUSDC per payment, receiver must be `GABQRET4…AMDWOM` |
| Asset | real testnet USDC, ASA `10458941` |

Reproduce: `npm run attack`

## Independent verification, without trusting this repository

The agent account's spending authority is public. Anyone can confirm that its
own key can no longer move its money:

```bash
curl -s https://testnet-api.algonode.cloud/v2/accounts/DORZEEZDH73RWH7ETRTVBMDECSA7JT5ZU6IFAFTOFHTSB3O33F3WCWXOXI \
  | jq -r '.["auth-addr"]'
# BENS63EQYQ4T6IJPAOAJSXXHEYV72W6OWFHGPFPQTRJ7HQXDOD32OLULGM
```

Recompile `contracts/vault.teal.tmpl` with `GUARD_APP_ID = 768360225` and the
resulting program hash equals that address — so the account is governed by
exactly the published logic, with no second key hidden anywhere.

## The proof pair

**A policy-compliant payment settles.**

> `honest-payment` — 0.01 USDC to the allowlisted merchant, inside the cap.
> Settled: [`QDARLDWMI7UYWV25MIKMYZFJV3IBCAK23KYYHV3WIQIBQ4LUONPQ`](https://lora.algokit.io/testnet/transaction/QDARLDWMI7UYWV25MIKMYZFJV3IBCAK23KYYHV3WIQIBQ4LUONPQ)
> Agent balance delta: **−10000 microUSDC**.

**The same payment over the policy cap cannot exist.**

> `jailbreak-overspend` — the agent tries to pay 10× the cap.
> Facilitator response: `transaction rejected by ApprovalProgram`
> Agent balance delta: **0**. No transaction id, because no transaction exists.

## Full battery — 8 scenarios, 8 as expected

| Scenario | What is attacked | Result | Enforced by |
|---|---|---|---|
| `honest-payment` | — | **settled** | — |
| `jailbreak-overspend` | pay 10× the cap | **blocked** | guard app |
| `jailbreak-redirect` | pay the attacker | **blocked** | guard app |
| `guard-mutant` | guard that rejects must kill the group | **blocked** | group atomicity |
| `rekey-smuggle` | rekey hidden in the payment group | **blocked** | facilitator |
| `closeout-sweep` | asset close-out hidden in the group | **blocked** | facilitator |
| `guard-omitted` | build the group without any guard | **blocked** | vault LogicSig |
| `guard-substituted` | swap in a permissive guard of your own | **blocked** | vault LogicSig |

**7 attacks blocked on-chain · 0 unexpected results.**

Verbatim chain responses, in order: `transaction rejected by ApprovalProgram`,
`transaction rejected by ApprovalProgram`, `rejected by logic err=assert failed
pc=98`, `Rekey transactions are not allowed: Transaction at index 2 has rekeyTo
set`, `Close-to transactions are not allowed: Transaction at index 2 has
AssetCloseTo set`, `rejected by logic err=assert failed pc=98`, `rejected by
logic err=assert failed pc=98`.

## Who blocks what — and what we did not build

Two of the eight rows are blocked by the **facilitator's own** security
constraints, not by us. We inherit them and say so.

The last two rows are the ones that matter for the obvious question — *can the
agent simply skip the guard?* It cannot: the account is rekeyed to a LogicSig
that refuses to authorise a transfer unless a call to **that specific** guard
application, naming **that specific** transaction index, is present in the same
group. Omitting it fails. Substituting a friendlier guard fails.

What we still do not protect against is in
[KNOWN_BYPASSES.md](KNOWN_BYPASSES.md). It is a short list, and it is honest.

---

## Without the facilitator — direct submission to a node

Recorded 2026-08-18. Every table above observes its refusal through the hosted
facilitator, which reaches it via `algod simulate`. This battery removes the
facilitator: the group is built, signed in full and handed straight to
`https://testnet-api.algonode.cloud`. What refuses here is the node running the
approval program.

Reproduce: `npm run onchain`

| Scenario | Result | Chain response |
|---|---|---|
| `guarded-payment` — within cap, to the allowlisted merchant | **settled** | `TLE4VKN5Z4KG3HF7JTCVWQPIAHFUMJXV4MVLJGFEE3MFW4HDINOQ` |
| `redirect-to-attacker` — same group, receiver swapped | **blocked** | `rejected by ApprovalProgram` |
| `over-the-cap` — ten times the cap, allowlisted receiver | **blocked** | `rejected by ApprovalProgram` |
| `guard-omitted` — the payment alone, no guard call | **blocked** | `rejected by logic err=assert failed pc=33` |

4/4 as expected. The last row is the one that matters most: with no guard call
in the group, it is the **vault LogicSig itself** that refuses to authorise the
transfer — no application logic, no facilitator, no server of ours anywhere in
the path.

Group shape here is `[0] guard app-call (operator-signed, pooled fee)` and
`[1] payment axfer (vault-signed, fee 0)`. It is not an x402 group — there is no
facilitator fee-payer transaction to sign — which is exactly the point: the
enforcement survives the facilitator's absence.
