# Where an allowlisted address comes from

A guard that only pays allowlisted addresses raises the obvious question: **how
does an address get on the list?** If we put it there, we are the trust anchor —
and we have just moved the problem, not solved it.

So an address earns its place by proof.

## The mechanism

1. The merchant publishes its payout address on its own domain. Ours is at
   [`.well-known/x402-payto.txt`](.well-known/x402-payto.txt), served over HTTPS.
2. A [Primus](https://primuslabs.xyz) attestor joins the TLS session to that
   domain, witnesses the bytes it serves, and signs a statement about them. The
   merchant does nothing special; the attestor needs no cooperation.
3. The registry contract on Algorand **recomputes the exact digest the attestor
   signed**, recovers the signer with `ecdsa_pk_recover(Secp256k1)`, and records
   the address only if that signer is the allowlisted attestor.
4. **The registry call rides inside the payment group.** The guard's own
   allowlist is still a compiled-in constant — it does not read the registry
   box, and we do not pretend otherwise. It does not need to: put the
   registration call in the same atomic group as the payment, and the payment
   settles only if the attestor's signature verifies on chain for the address
   being paid. Forge the attestation and the group dies with it.

```
merchant domain ──TLS──> attestor ──signature──> Algorand contract
    publishes            witnesses               recovers it on chain
                                                        │
                          ┌─────────────────────────────┘
                          ▼   all four in ONE atomic group
        [guard] [attestation] [budget] [payment]   → settles, or none of it does
```

Reproduce: `npm run attested`

| Scenario | Result | Chain response |
|---|---|---|
| Genuine attestation in the payment group | **settled** | round 66429905, `DJ5YHNRTD76PT46HKNU5LUJL7FULGW2SU2F33J6PCY5K5HEIEQ7A` |
| Payee swapped, signature untouched | **blocked** | `rejected by ApprovalProgram` — the payment dies with it |
| No registry call in the group at all | **settled under v1** | round 66430324 — nothing in guard v1 required it |
| No registry call in the group at all | **blocked under v3** | `assert failed pc=297`, app `769462393` |

We recorded that gap before we closed it, and we left both rows standing. Under
guard v1 a **forged** proof could not be used but an **absent** one was not
refused. Guard v3 (app `769462393`, `npm run attested3`, 5/5) requires the
registry call in the group and names the payee in it. It still does not read the
registry box, and it does not need to: the proof rides in the payment.

The digest is reproducible from published fields, which is what makes on-chain
verification possible at all:

```
requestHash = keccak256(url ‖ header ‖ method ‖ body)
digest      = keccak256(recipient ‖ requestHash ‖ responseHash ‖ data
                        ‖ attConditions ‖ timestamp ‖ additionParams)
```

Primus signs that digest **raw** — no EIP-191 prefix — which costs one
`keccak256` less on chain. Verification totals roughly 2,390 opcode units
(`keccak256` 130 ×2, `ecdsa_pk_recover` 2,000, address hash 130), so the
registration group carries three cheap application calls purely to raise the
pooled budget.

## Proof

TestNet, registry app [`769213326`](https://lora.algokit.io/testnet/application/769213326),
attestor `0xdb736b13e2f522dbe18b2015d0291e4b193d8ef6`:

| | |
|---|---|
| Genuine attestation | **accepted** — [`HIKIIHFPEAPEPTKJELSRMHEI52CZXV7BF2S5LI6GZZ3NSZKHQOZQ`](https://lora.algokit.io/testnet/transaction/HIKIIHFPEAPEPTKJELSRMHEI52CZXV7BF2S5LI6GZZ3NSZKHQOZQ), recorded at round 66279983 |
| Same attestation, payee swapped for an attacker, signature untouched | **rejected by ApprovalProgram** |

Reproduce:

```bash
node scripts/attest.mjs      # ask an attestor to witness the domain
node scripts/digest.mjs      # reproduce the signed digest, recover the signer
node scripts/registry.mjs register   # verify it on chain
node scripts/registry.mjs show       # what the registry holds
```

## What this does and does not prove

**It proves** the address was served by that domain, witnessed by a party that
is not us, and that the chain — not our code — decided whether to believe the
attestation. It is the machinery by which an address could earn its place on a
list without our say-so.

**It does not mean** the guard reads the registry. That allowlist is still a
constant we chose and compiled in, and closing that particular loop needs a new
immutable app. What the group above shows is narrower and, we think, more
useful: a payment that carries the proof of its own payee, enforced by the same
atomicity that enforces everything else here. The naming problem below is
untouched by any of it.

**It does not prove** the domain belongs to the merchant your agent meant to buy
from. A lookalike domain, a lapsed-and-resquatted domain, or a mis-issued
certificate all still produce a valid attestation. The gap we close is *"the
server asserts its payee"* → *"the domain cryptographically asserts its payee,
enforced inside the payment"*. The remaining gap — domain to legal identity —
needs a naming layer, and we are not claiming it.

**Also honest:** this is not a zero-knowledge proof verified on chain. The
MPC-TLS work happens off-chain between the attestor and the domain; what the
contract verifies is the attestor's signature. Calling it "zk verification on
Algorand" would be wrong. It is an attestation, checked by the ledger.

**And:** the attestation carries a timestamp but never expires by itself, so a
rotated or compromised merchant address cannot be un-attested by the artifact.
The registry stamps the round at registration so the guard can require freshness
and force periodic re-attestation.

One attestor signs today. Primus's multi-attestor network uses the same digest
and the same 65-byte signature, so the verifier already accepts it — moving from
one signer to several is a registry entry, not a redesign.
