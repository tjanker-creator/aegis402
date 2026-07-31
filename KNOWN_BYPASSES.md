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

## 6. Operator key compromise degrades to policy

If the operational key leaks, the attacker can request guard approval — that is
all. They cannot exceed the cap, pay a non-allowlisted address, omit the guard,
or substitute a friendlier one. The blast radius of a stolen agent key becomes
"can spend within policy", which is the point, but it is not nothing.
