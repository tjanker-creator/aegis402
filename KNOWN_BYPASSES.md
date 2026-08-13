# Known bypasses

A security claim you cannot falsify is not a security claim. This is what
AEGIS402 does **not** protect against.

## 1. The ledger gates the payment, not the action

AEGIS402 makes it impossible for a guarded payment to settle against policy. It
does **not** make it impossible for a compromised agent to act.

An agent that abandons the protocol entirely can still run
`npm install <malicious-package>`, leak data, or call an unpaid API. Nothing on
a blockchain stops an off-chain action by an actor who never asks the chain for
permission.

* **Ledger property:** vault funds cannot move against policy.
* **Client property:** an honest agent gates its action on a settled payment, so
  a blocked payment means the action does not happen.

We state it in that order deliberately. "No verification → no action" as a
ledger guarantee would be false.

## 2. Policy correctness is the operator's responsibility

The guard enforces exactly what it was deployed with. A cap set too high, or an
allowlisted address you did not vet, is enforced faithfully and uselessly. The
guard app is immutable — update and delete calls are rejected — which removes
"someone quietly relaxed the rule" as a risk, and equally means a wrong policy
must be replaced rather than patched.

## 3. Migration is a manual step, and rekeying is one-way in practice

Protection starts when funds live in an account rekeyed to the vault LogicSig.
Funds anywhere else are unguarded. And because the vault deliberately refuses to
sign any transaction with `RekeyTo` set, an account rekeyed to a given vault
cannot later be moved to a different vault: to change policy shape you move the
funds out through a compliant payment and into a new vault. That is a real
usability cost of making the guarantee hard, and we prefer it to a vault with an
escape hatch.

## 4. We inherit the facilitator's trust boundary

Settlement runs through the hosted GoPlausible facilitator. It cannot redirect
funds — the payer's signature fixes amount, asset and receiver — but it can
refuse to settle, and it chooses when to submit. Liveness depends on it. Running
your own facilitator removes that dependency and uses the same code path.

Related: our evidence shows that *this* facilitator accepts a client-signed
guard call in the payment group. It does not prove that every facilitator must.
The x402 SVM specification explicitly advises sponsors to allowlist which
programs may reach the simulation path, so a hardened facilitator could
legitimately refuse guards.

## 5. Not audited, not on mainnet

The TEAL is small and deliberately boring, but it has had no external review.
Everything here runs on TestNet with test funds. Do not put real money behind it
in this state.

## 6. Operator key compromise is bounded by the receiver, not by the amount

An earlier version of this file said a stolen operational key "cannot exceed the
cap". **That was wrong, and the correction matters more than the original
claim.**

The guard v1 cap is enforced per *transaction*, and nothing in `policy.teal`
constrains the size or shape of the group. So a holder of the operational key
can build one group containing several transfers, each individually within the
cap, each with its own guard call naming its own index — and spend a multiple of
the cap in a single atomic group, repeatable every round. Guard v1 also never
pins the asset id, so its cap is denominated in units of whatever asset is being
transferred.

The true bound on a stolen operational key is therefore: **funds can only go to
the allowlisted receiver.** That is still the property we care about most — the
money can only move somewhere chosen while sober — but it is not a spending
limit, and we will not call it one.

Guard v2 fixes both: it counts the asset transfers in the group and accepts
exactly the two it was handed, and it pins the asset id. Guard v1 is immutable
and cannot be patched, which is the cost of immutability and is stated here
rather than quietly fixed.

Found by adversarially reading our own TEAL before the final rather than after.
