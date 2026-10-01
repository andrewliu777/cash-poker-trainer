# S0 baseline and rule decisions

Date: 2026-09-29. Private development copy: `cash-trainer`, branch `cash-trainer`, no Git remote. Source: `Tehes/poker@2be825f6f86db26b5aecaf511e7938b04f3ea1ba` (2026-09-13). The original checkout remains clean.

## Test baseline

Deno is not installed on this machine. The 55 existing `Deno.test` cases ran under Node 24.19.0 with a temporary `node:test` adapter:

```sh
node --input-type=module --eval 'import test from "node:test"; globalThis.Deno = { test }; await import("./js/gameEngine.test.js"); await import("./js/bot.test.js");'
```

Result before new tests: **55 passed, 0 failed**. This runs the test bodies but does not prove compatibility with Deno itself or browser behavior.

Two regression cases were then added. Result before the rule fix: **56 passed, 1 failed**. A bet of 100, B call, C all-in to 150, D call still allows A to raise; expected only fold or call. A second case shows that cumulative short all-ins from 100 to 125 to 200 do allow A to raise. The latter currently passes. The rule follows [Poker TDA Rule 49 and its examples](https://www.pokertda.com/view-poker-tda-rules/) and [WSOP live action no-limit rules 172–174](https://www.wsop.com/pdfs/2012/2012-Live-Action-Rules.pdf).

## Frozen v1.0 rule choices

- NLHE, 2–6 dealt seats, one human plus rule bots as the primary flow. No rake, ante, straddle, real-money settlement, or original remote multiplayer in v1.0.
- Amounts are integer counts of the smallest configured chip unit. Display labels may use decimals; money calculations do not use floating point. The default source game remains 10/20 in existing chip counts until the cash-table configuration is added.
- Blind values stay fixed during a cash session. Buy-in depth is expressed in BB. Top-ups and leave/pause changes occur between hands and are ledgered separately from pot winnings.
- A full raise reopens betting. One short all-in does not; multiple short all-ins can cumulatively reopen it. An unacted player retains the raise option. No fixed cap on valid no-limit raises.
- The existing UI action amount means **additional chips paid now**. The later agent boundary will use **street total to** and convert explicitly, preserving the original amount separately in hand records.

## Baseline risks and next nodes

- `gameEngine.js` lacks per-seat raise-right state; `resolveTurnAction` accepts the short-all-in re-raise above. `R1` will add that state and strict action validation.
- `gameEngine.js`, `app.js`, and `bot.js` contain ten-chip rounding assumptions. `M1` will isolate the smallest-chip unit and check split-pot conservation.
- Current save is a single localStorage continuation snapshot, not a hand history. `H1` is required before replay and long-term statistics.
- The solo game does not need remote sync, but `index.html` loads Google Fonts and Umami. `L1` will make training mode fully local.
- `visibleHoleCards` describes what the table UI displays, not what an agent may learn. `O1` will construct a new seat-specific observation.
- Existing bot tests only cover five action-normalization cases. Bot strength remains unknown until `Q1` and `B1`.

S0 exit: baseline and known failure recorded; proceed to `R1` and `M1`. Browser and Deno checks remain version-specific gates before v1.0.
