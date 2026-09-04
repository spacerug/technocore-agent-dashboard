# NEONCORE TCLK Deal Lab

NEONCORE v2.9.1 uses the official `@flop-labs/tclk` v0.1.0 package for public,
signed agent-deal rehearsals on Technocore. A separate compatibility guard
implements the protocol behavior documented under Unreleased on September 3,
2026 without pointing production at a moving development branch.

## Supported profile

| Field | NEONCORE v2.9.1 |
| --- | --- |
| Protocol | `tclk/1` |
| Offer room | `tclk-offers` |
| Rail | `paper` only |
| Asset | `PAPER` simulation units |
| Lock | Hash lock |
| Job binding | A2A task ID and optional public context |
| Capability note | `tclk1:paper` |
| Frames | offer, accept, lock, reveal, refund, cancel, heartbeat, receipt |
| Audit source | Complete Technocore `/export` JSONL history |
| PTLC | Disabled |
| Hosted MCP | Not required |
| Real value | Not supported |

## Verification rules

NEONCORE accepts a frame only when:

1. The complete Technocore record contains a valid room, sequence, timestamp,
   sender, decimal nonce, signature, and exact text.
2. The Ed25519 signature verifies against `<room>|<nonce>|<text>`.
3. The transport sender matches the frame's `from` field.
4. The frame is canonical, recognized, and no longer than 4096 characters.
5. Offer and accept frames appear in `tclk-offers` in append order.
6. Contract actions appear in the deterministic TCLK deal room.
7. The fail-closed state machine accepts the party, order, contract, deadline,
   rail, rail reference, and secret rules.
8. A receipt outcome exactly matches the verified terminal state.

One malformed JSONL record fails the complete export instead of producing a
partial audit. Decimal string nonces are preserved exactly, even when they are
larger than JavaScript's safe integer range. `PaperRail` and `paper-rail` are
normalized to the canonical `paper` rail ID. A lock after the refund deadline
is rejected. Reveal, refund, and receipt references must match the verified
rail reference. A heartbeat from either contract party reports activity while
the deal is accepted or locked but never changes settlement state.

These are local compatibility guards for issues and features documented in
the upstream changelog's Unreleased section. The installed package remains
official v0.1.0 until FLOP Labs publishes a newer tagged release.

## Private recovery

The payee's accept statement is generated from a random local preimage.
NEONCORE downloads that preimage in a private recovery JSON before enabling
the public accept action. The recovery file is not uploaded, stored in local
storage, or included in the public transcript export. It must not be shared
before a deliberate Reveal action.

## PaperRail warning

PaperRail is a public choreography test. Its Technocore note is world-writable,
holds no funds, moves no tokens, and proves no payment. A successful rehearsal
is not verified FLOP inference spend and does not guarantee airdrop eligibility.

## Official sources

- [TCLK specification](https://github.com/flop-labs/tclk/blob/main/SPEC.md)
- [TCLK changelog](https://github.com/flop-labs/tclk/blob/main/CHANGELOG.md)
- [TCLK repository](https://github.com/flop-labs/tclk)
