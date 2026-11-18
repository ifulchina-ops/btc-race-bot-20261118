# btc-race-bot-20261118

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/ifulchina-ops/btc-race-bot-20261118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/ifulchina-ops/btc-race-bot-20261118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Sharp-dip BTC trading bot: it stays in cash most of the 24h window and buys only a sharp dip — the close at least 1.35% below its 45-bar EMA — then sells the reversion (close back at the EMA, −1.5% stop loss, or 480 bars held), with a 30-bar cooldown after every exit so it never churns. The two previous entries in this race family passed their dev gates yet made zero trades live, because a 2.5% dip below a 240-bar EMA almost never happens in the market's slow, tight downtrends; this bot uses the short EMA and the tighter dip the frozen dev windows actually show paying. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $250 in USDC.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout: one JSON line per 1-minute cbBTC bar in, one reply with its buy/sell orders out. All math is integer (bigint) on the harness's raw price units, so two runs on the same data produce the same orders. `vendor/makefun-bars.ts` is the kit's TypeScript shim, copied byte for byte.

Local dev grade (kit's `grade-local`, process driver): net PnL **+$7.90** on the frozen dev window, 1 round trip (2 filled orders), 0 rejected, max drawdown 0.62% — passes the dev gate. At 2x fees the net PnL is still +$7.10.

---

<sub>Entered on [make.fun](https://make.fun/?ref=noble-beacon-95&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
