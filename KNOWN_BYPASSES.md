# Known bypasses

A security claim you cannot falsify is not a security claim. This file lists
what AEGIS402 does **not** protect against. It is part of the submission on
purpose, and `npm run attack` prints these as RED rows next to the green ones.

## 1. The ledger gates the payment, not the action

AEGIS402 makes it impossible for a guarded payment to settle against policy.
It does **not** make it impossible for a compromised agent to act.

An agent that has abandoned the protocol entirely can still run
`npm install <malicious-package>` or exfiltrate data without paying anyone.
Nothing on a blockchain can stop an off-chain action by an actor who never
asks the chain for permission.

* **What is a ledger property:** guarded funds cannot move against policy.
* **What is a client property:** an honest agent gates its action on a settled
  payment, so a blocked payment means the action does not happen.

We state this in that order, deliberately. Claiming "no verification → no
action" as a ledger guarantee would be false.

## 2. An agent holding its own key can omit the guard

In the current build the policy app-call is added by the AEGIS client. An agent
that controls its own signing key can simply build a plain
`[fee-payer, payment]` group and skip the guard entirely. The harness proves
this: scenario `guard-omitted` **settles**, and we print it in red.

The fix is designed and is the next milestone: the funds live in a vault
account whose signing authority is rekeyed to an immutable LogicSig that
refuses to sign an outgoing transfer unless the bound policy app-call is
present in the same group. Then omission stops being possible rather than
being discouraged. Until that ships, treat Deadbolt as *opt-in* enforcement:
it protects an agent that wants to be protected, and any funds you route
through it.

## 3. Policy correctness is your responsibility

The policy app enforces exactly what it was deployed with — a per-transaction
cap and an allowlisted receiver. A cap set too high, or an allowlist
containing an address you did not vet, is enforced faithfully and uselessly.
The policy is immutable after deployment (update and delete calls are
rejected), which removes the "someone quietly relaxed the rule" risk but also
means a wrong policy must be replaced, not patched.

## 4. We inherit the facilitator's trust boundary

Settlement runs through the hosted GoPlausible facilitator. It cannot redirect
funds — the payer's signature fixes amount, asset and receiver — but it can
refuse to settle, and it decides when to submit. Liveness depends on it. A
self-hosted facilitator removes that dependency and is supported by the same
code path.

## 5. Not yet audited, not yet on mainnet

The TEAL is small and deliberately boring, but it has had no external review.
Everything in this repository runs on Algorand TestNet with test funds. Do not
put real money behind it in its current state.
