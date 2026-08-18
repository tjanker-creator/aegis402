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
all. They cannot pay a non-allowlisted address, omit the guard, or substitute a
friendlier one.

They **can** exceed the cap, and we had this wrong here until we re-read our own
TEAL before the final. The v1 cap is enforced per transaction, and neither the
guard nor `vault.teal.tmpl` bounds the group: an attacker pairs each additional
transfer with its own guard call naming its own index, and an Algorand group
holds sixteen transactions — roughly seven such pairs, so roughly seven times the
cap in one group. v1 is immutable, so this stays true of v1 and stays written
down. `policy2.teal` (app `769214187`) counts every asset transfer in the group,
requires exactly one payment and one fee, and pins the asset id.

The real bound on a stolen operational key is therefore **the allowlisted
receiver, not the amount** — which is the point, but it is not nothing.

## 6. The provenance check is available, not required (v1)

`npm run attested` shows the zkTLS attestation riding inside the payment group,
and a forged attestation killing the payment. It also shows the uncomfortable
third case: **omit the registry call entirely and the payment settles.**

Nothing in guard v1 requires provenance. The vault requires the guard call; the
guard requires the cap, the payee and (in v2) its own fee. None of them asks
where the payee came from. So an operator who simply leaves the attestation out
gets a payment that settles without one.

**Resolved in v3.** `contracts/policy3.teal` is deployed as app `769462393`: it
scans the group for a `register` call to registry `769213326` whose attested
address is the address being paid, and rejects if it is absent. `npm run
attested3` records the same scenario blocked, at `assert failed pc=297`.

v1 remains immutable and remains as described above, so both states are recorded
rather than one quietly replacing the other. The account protected by v3 is a
different account: the v1 payer is rekeyed to a vault that forbids `RekeyTo`, so
it can never be moved to a newer guard. That is the unskippability working
against us, and it is why v3 needed a fresh account rather than an upgrade.
