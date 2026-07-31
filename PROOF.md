# Proof

Recorded 2026-07-31 on **Algorand TestNet**, settled through the **live hosted
GoPlausible facilitator** at `https://facilitator.goplausible.xyz` — not a local
mock, not a modified facilitator.

* Policy app: [`768360225`](https://lora.algokit.io/testnet/application/768360225) — immutable (update and delete calls are rejected)
* Policy: per-transaction cap **50000 microUSDC**, allowlisted receiver `GABQRET4USJ5PJM2EUV7PV6L64O7AP3E2XLS3HMUXFIMPMQLDFTFAMDWOM`
* Asset: real testnet **USDC**, ASA `10458941`
* Agent (payer): `DORZEEZDH73RWH7ETRTVBMDECSA7JT5ZU6IFAFTOFHTSB3O33F3WCWXOXI`

Reproduce with `npm run attack`.

## The proof pair

**A payment that satisfies the policy settles.**

> `honest-payment` — 0.01 USDC to the allowlisted merchant, inside the cap.
> Settled: [`256SCA6TQLIWGL2MLN555X6XVZ6C5ZQBGZNICYWCTBWHIVELCEUA`](https://lora.algokit.io/testnet/transaction/256SCA6TQLIWGL2MLN555X6XVZ6C5ZQBGZNICYWCTBWHIVELCEUA)
> Agent balance delta: **−10000 microUSDC**.

**The same payment, over the policy cap, cannot exist.**

> `jailbreak-overspend` — the agent tries to pay 10× the cap.
> Facilitator response, verbatim:
> `Transaction simulation failed: transaction P4QQ4SBG5XQ4U3OTIZVQ4ZJKOF3MJAGK4YMJZ5ETVSRW74ZTQKZA: transaction rejected by ApprovalProgram`
> Agent balance delta: **0**. There is no transaction id, because there is no transaction.

That asymmetry is the entire product: the difference between the two runs is a
single client-signed application call riding in the same atomic group.

## Full battery

| Scenario | Expected | Result | Funds | Evidence |
|---|---|---|---|---|
| `honest-payment` | settle | **settled** | −10000 | txId `256SCA6TQLIWGL2MLN555X6XVZ6C5ZQBGZNICYWCTBWHIVELCEUA` |
| `jailbreak-overspend` | block | **blocked** | unchanged | `rejected by ApprovalProgram` |
| `jailbreak-redirect` | block | **blocked** | unchanged | `rejected by ApprovalProgram` |
| `guard-mutant` | block | **blocked** | unchanged | `rejected by ApprovalProgram` |
| `rekey-smuggle` | block | **blocked** | unchanged | `Rekey transactions are not allowed: Transaction at index 2 has rekeyTo set` |
| `closeout-sweep` | block | **blocked** | unchanged | `Close-to transactions are not allowed: Transaction at index 2 has AssetCloseTo set` |
| `guard-omitted` | **settle (RED)** | **settled** | −500000 | txId `EZ623R3IYFRYV5EIVH3THKHYDHWIAELWUCPCIIIN5UN4RQPHET6Q` |

**5 attacks blocked on-chain · 1 deliberately not blocked · 0 unexpected.**

## About the red row

`guard-omitted` succeeds, on purpose, and we publish it. An agent that holds its
own signing key can build a plain `[fee-payer, payment]` group and skip the
policy call — so at this stage AEGIS402 is opt-in enforcement. The last two rows
are also worth noting for a different reason: `rekey-smuggle` and
`closeout-sweep` are blocked by the *facilitator's own* security constraints,
not by us. We inherit them, and we say so.

See [KNOWN_BYPASSES.md](KNOWN_BYPASSES.md) for the full list of what this does
not protect against, and the vault design that closes the `guard-omitted` hole.
