# A note on the exact-AVM scheme: payment groups admit preconditions

This is a note for the authors of the AVM x402 scheme rather than a product
pitch. It states the property AEGIS402 relies on, our evidence for it, what it
costs the operator, and one question we would like answered.

## The property

`scheme_exact_algo` validates a payment group as follows: the transaction at
`paymentIndex` must be an asset transfer whose amount, receiver and asset id
match the payment requirements; any transaction sent by a facilitator-managed
address must be a zero-amount self payment within the fee cap; across the whole
group, `keyreg`, in-group `rekeyTo` and close-outs are forbidden; unsigned
transactions may only come from facilitator addresses. Everything else is
handed to `algod simulate`, and the group is accepted if and only if simulate
reports no failure.

There is no per-type allow list. A **client-signed application call is therefore
a legal member of a payment group**, and because Algorand groups commit
atomically, its approval program becomes a **precondition of the payment**. If
it rejects, simulate fails, `/settle` never submits, and the transfer cannot
exist.

We read this as intentional rather than accidental: the scheme document already
anticipates groups that "perform several operations to facilitate the payment,
such as swaps or asset transfers". Preconditions are the same mechanism pointed
at a different problem.

## Evidence

Verified twice, and we distinguish the two carefully:

1. **Against the published implementation** — the control flow above was read
   from the compiled `ExactAvmScheme` facilitator sources on npm. This is
   evidence about a package, not about a running service.
2. **Against the live hosted facilitator** — on 2026-07-31 we settled a
   three-transaction group `[fee-payer, policy app-call, payment]` on TestNet
   through `facilitator.goplausible.xyz`
   ([`256SCA6…`](https://lora.algokit.io/testnet/transaction/256SCA6TQLIWGL2MLN555X6XVZ6C5ZQBGZNICYWCTBWHIVELCEUA)),
   and confirmed that a group whose policy call rejects returns
   `Transaction simulation failed: … rejected by ApprovalProgram` with no
   ledger effect. Full table in [PROOF.md](PROOF.md).

One clarification we want to make ourselves, before anyone else does: `simulate`
is the facilitator's **admission control**, not the enforcement. Enforcement is
group atomicity at submit time. A facilitator that skipped simulate entirely
would still be unable to settle a group whose application call rejects — it
would merely discover the failure later.

## What it costs the operator

The fee-payer transaction pools the fee for the entire group, up to
`MAX_REASONABLE_FEE`. A guard therefore costs the paying agent **nothing**: our
three-transaction group needs 3000 microAlgo, all covered by the facilitator's
pooled fee. This is excellent for adoption — security with zero marginal cost to
the payer is a rare thing — but it means the facilitator subsidises the
verification compute of guard transactions it did not ask for, and `/verify` can
be called without a subsequent `/settle`.

We raise this as a question, not a claim: **is that subsidy intended at the
current fee cap?** If it is, guards are free for agents and the ecosystem gets a
security layer at no cost to users. If it is not, the natural remedies are a
lower group-size limit for non-payment transactions, or requiring the payer to
carry the fee for transactions beyond the payment itself.

## The question

We built AEGIS402 assuming preconditions-in-group are a supported use of the
scheme. If that is right, we would like to write the pattern down properly — a
minimal interface for guard applications (fixed argument layout so wallets and
clients can compose guards from different authors) submitted as an ARC, with
this repository as the reference implementation. If it is not right, then our
contribution is this note rather than the product, and we would rather hear that
now.

Either answer is useful to us.
