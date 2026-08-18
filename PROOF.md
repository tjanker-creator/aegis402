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

---

## The payment carries the proof of its own payee

Recorded 2026-08-18. The guard enforces an allowlist; the obvious objection is
who put the address on it. This battery answers it inside the payment group: the
zkTLS registry call is bundled with the guard and the transfer, so the group
settles only if an Algorand contract recovers the Primus attestor's secp256k1
signature over the exact bytes the merchant's domain served — naming the very
address being paid.

Reproduce: `npm run attested`

| Scenario | Result | Chain response |
|---|---|---|
| `attested-payment` — genuine attestation in the group | **settled** | round 66429905 · `DJ5YHNRTD76PT46HKNU5LUJL7FULGW2SU2F33J6PCY5K5HEIEQ7A` |
| `forged-attestation` — payee swapped, signature untouched | **blocked** | `rejected by ApprovalProgram` |
| `attestation-omitted` — no registry call in the group at all | **settled** | round 66430324 · `UYTXNCOXB6SWJXQIXTBE4STEU6HAZCRMNBUZJIFXIAMAPFDBWEFQ` |

3/3 as expected — and the third row is the one worth reading. A **forged**
attestation kills the payment. An **absent** one does not, because guard v1
never asked for it: the vault requires the guard call, and the guard requires
the cap and the payee, but nothing in v1 requires provenance. So the honest
claim today is *"a forged proof cannot be used"*, not *"no payment without
proof"*.

`contracts/policy3.teal` closes that: it scans the group for a `register` call
to the registry whose attested address is the payee, and rejects without one. It
compiles to 302 bytes and is not deployed — creating an app costs 0.1 ALGO in
minimum balance and the operator account has 0.045 free. The account that does
hold ALGO is rekeyed to a vault that signs only asset transfers, so its balance
cannot pay for anything. That is our own unskippability working against us,
exactly as advertised. `npm run deploy-v3` runs the moment the account is topped
up.

2/2 on the property we claim. Group shape: `[0] guard app-call` · `[1] registry app-call (12 args, box
ref)` · `[2..4] budget pads` · `[5] payment axfer (vault-signed, fee 0)`. The
pads exist only to pool opcode budget for `ecdsa_pk_recover`, which costs 2000
units against a 700-unit per-call allowance.

Attested address `GABQRET4USJ5PJM2EUV7PV6L64O7AP3E2XLS3HMUXFIMPMQLDFTFAMDWOM`
is the same address the guard allowlists — both facts are public and checkable.

**Running total across all batteries: 20 scenarios, 4 settle, 16 refuse.**

---

## A per-transaction predicate is not a per-group policy

Recorded 2026-08-18. This is the one row in this file that is **not** a defence.
It is a finding about the exact-AVM scheme, carrying the facilitator's own
signature.

Reproduce: `npm run multiply`

x402's `paymentRequirements.amount` was `50000` microUSDC and `paymentIndex` was
`2`. The group carried **seven** payments of 50000, each paired with its own
guard call naming its own index — every pair individually legal.

| Scenario | Result | Chain response |
|---|---|---|
| `cap-multiplied` — 7 payments, one 50000 invoice | **settled** | `/verify` → `isValid: true`, `/settle` → group `eKo3z/V9pOySwib3+AB8ZFT3xRuBGZy7Vi85v3XklTM=`, round 66430649, 15 txns, **350000 microUSDC moved** |
| `v2-counts-the-group` — same shape, group-aware guard | **blocked** | `rejected by ApprovalProgram` |

Transaction `[0]` of that group was signed and paid for by
`ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA` — the hosted
GoPlausible facilitator's own fee-payer. It pooled the fees for all fifteen
transactions, including the seven we added.

**What this means.** `isValid: true` is not a spending bound. It says one
transaction in the group matches the invoice. For a human payer that is a
footnote. For an agent payer — the entire premise of x402 — the group is
attacker-constructible, and neither side of the protocol has a field that bounds
it. Our v1 guard has the same shape and the same flaw, which is how we found it.

`policy2.teal` (app `769214187`) counts every asset transfer in the group and
requires exactly one payment and one fee. That is the fix, and it is deployed.
The general version belongs in the scheme, not in one project's guard — see
[SPEC-NOTE.md](SPEC-NOTE.md).

**Running total: 23 scenarios, 6 settle, 17 refuse — and one of the six is this one.**

---

## Guard v3: the provenance proof is required, not merely available

Recorded 2026-08-18, after the battery above showed an **absent** attestation
settling. Guard v3 (app `769462393`) closes it: it pins the asset, bounds the
group to exactly one transfer, and scans the group for a `register` call to
registry `769213326` whose attested address is the address being paid. Without
one, it rejects.

The account it protects is `3HD7EYSY5RHYAMA4B3OEBUAVO474NKFLF4QKGEICLQ7WTIXY2OWXDA37CA`,
rekeyed to vault `546JBIRD763MG7N4OXGFCRBCSPIUV73KSZH7UEPKZSF4LUKPGMOLZEEDVA` —
recompile `vault.teal.tmpl` with `GUARD_APP_ID = 769462393` and you get that
address, which is the whole no-second-key argument.

Reproduce: `npm run attested3`

| Scenario | Result | Chain response |
|---|---|---|
| `attested-payment` — genuine attestation in the group | **settled** | round 66431495 · `HMV3TACI2NPZTXRGYQLU42DWVZ43GNLI5S2STIVQKHIS6SBNA3EA` |
| `forged-attestation` — payee swapped, signature untouched | **blocked** | `assert failed pc=297` (app 769462393) |
| `attestation-omitted` — no registry call at all | **blocked** | `assert failed pc=297` — **v1 settled this; v3 does not** |
| `redirect-to-attacker` — valid proof, money sent elsewhere | **blocked** | `rejected by ApprovalProgram` |
| `over-the-cap` — valid proof, ten times the cap | **blocked** | `rejected by ApprovalProgram` |

5/5. The third row is the point of the whole exercise: it is the same scenario
that settles under v1, recorded in both states rather than quietly replaced.

**Running total: 28 scenarios, 7 settle, 21 refuse. Two of the seven are
findings rather than passes, and both of those are ours.**
