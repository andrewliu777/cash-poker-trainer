# Q1 cash bot feasibility gate — 2026-09-29

## Decision

**Go to B1 adaptation as an engineering base. No-go for treating the current bot as the main cash-game sparring opponent or as a source of correct answers.** The rule bot can finish cash hands and respond to position, cards, and public actions. Its tournament pressure model is still active, and one repeatable invalid-action branch remains. B1 must fix those issues and use a separate holdout sample before the product can claim a suitable cash-game opponent.

This gate decides whether to keep and adapt the bot. It does not certify strategy quality or GTO accuracy. H1 hand records remain the next implementation node before B1 under the DAG.

## Frozen experiment

`q1-bot-baseline.mjs` uses seed `20260929`, ten blocks of 100 hands, both candidate seats, and 20/100/200BB buy-ins at 10/20 blinds with no rake. Each condition has 2,000 heads-up hands. The two deliberately simple opponents are:

- **Station:** checks when possible, otherwise calls; never bets or folds.
- **Pressure:** makes one 3BB preflop raise or half-pot postflop bet per street when possible, otherwise checks or calls; never folds.

Each result is net chips after buy-ins and top-ups, expressed in BB per 100 hands. The interval is a descriptive normal approximation across ten paired blocks. Sessions reuse the same seed schedule with seats swapped. It is not a confidence statement about performance against competent people.

| Depth | Station BB/100 | Pressure BB/100 | Invalid bot requests |
|---:|---:|---:|---:|
| 20BB | +165.22 | +95.92 | 2 |
| 100BB | +175.37 | +382.15 | 0 |
| 200BB | +175.37 | +485.01 | 0 |

All 12,000 hands settled, blinds stayed fixed, and session chips plus invested amounts balanced. The full block summaries and descriptive intervals are in `q1-bot-baseline-results.json`. Positive results against opponents that never fold do not establish realistic cash-game strength.

The two invalid requests were in the same 20BB pressure session: on turn and river, no bet was outstanding and the bot requested `call` for 0 instead of `check`. The action gateway rejected each request, and the harness used the same legal-check fallback as the browser. This is a confirmed B1 correction, not a funds-loss or information-leak incident.

## Fixed-spot scan

`q1-fixed-spots.mjs` enumerates every two-card combination at 20/100/200BB in two six-seat unopened preflop positions, plus every legal two-card combination on one three-way flop. The same per-combination random seed is used across depths. The scan is descriptive; no solver label or assumed correct range is attached.

| Spot | 20BB actions | 100BB actions | 200BB actions |
|---|---|---|---|
| Six-seat UTG first in, 1,326 combos | 984 fold, 248 raise, **94 all-in** | 1110 fold, 122 call, 94 raise | Same as 100BB |
| Six-seat BTN first in after folds, 1,326 combos | 908 fold, 266 raise, **152 all-in** | 860 fold, 184 call, 282 raise | Same as 100BB |
| Three-way checked-to BTN flop, 1,176 combos | 333 check, 843 bet | 333 check, 843 bet | Same action counts as 100BB |

The 20BB open-shove rate is 7.1% of UTG combinations and 11.5% of BTN combinations in this fixed setup. That shift follows the code's M-ratio zone branches. It is a cash-game retuning target, not proof that each shove is wrong. The 100BB and 200BB action counts match exactly in these spots, so the fixed sample did not show a deeper-stack frequency change. Full counts and average bet sizes are in `q1-fixed-spots-results.json`.

## B1 entry conditions and holdout

1. Replace M-ratio, elimination-risk, and chip-leader incentives with cash-game assumptions. Handle 20BB short-stack decisions explicitly and inspect 40/60/100/200BB separately.
2. Fix `call` for 0 and reach zero invalid requests in the frozen Q1 cases and in fresh structural runs. Keep the engine fallback visible during testing.
3. Recheck six-seat unopened positions and the multiway flop with a separate range or expert review. Do not infer GTO from this frequency table.
4. Compare cash-adapted versions against a stronger frozen opponent pool and independent seeds not used for tuning. Report BB/100 with session/block uncertainty, decision-size distributions, and repeatable exploit probes. The Q1 seed is a development sample and must not be the final acceptance holdout.

The bot remains an opponent generator in the preview. It is not yet the training benchmark or an answer key.
