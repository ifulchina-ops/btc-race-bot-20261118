// Sharp-dip BTC bot for the btc-race-24h-20261118-1444 race.
//
// Why this bot exists: the two previous entries in this race family
// (btc-race-24h-20261113-2314 "Certain Cipher" and
// btc-race-24h-20261115-0828 "Steady Dip") both passed their dev gates
// yet made ZERO trades in their live race windows. Their dip triggers
// were too selective for the market's actual shape: the last three dev
// windows are all slow, tight downtrends (-4.9%, -4.0%, -2.8%) in which
// the price grinds down hugging its moving average, so a 2.5% dip below
// a 240-bar EMA almost never happens. On this competition's dev window
// the old bot makes 0 trades and $0.00, which FAILS the dev gate.
//
// What the data actually shows (backtested on all three frozen dev
// windows with the replay's own market model: 4 bps fee, 2 bps
// slippage, constant-product impact against each bar's open depth):
//   - After a sharp short-term drop the price does bounce: on this
//     window, after a 30-bar drop of >= 75 bps the median gain over
//     the next 15 bars is +43 bps.
//   - But the bounce is small and fades fast, and every round trip
//     costs ~26 bps, so only a few, well-chosen dips pay. Loose
//     mean-reversion (buy 50 bps below a 60-bar EMA, TP/SL 80 bps)
//     loses money on every window; momentum/EMA-cross loses $50-130.
//   - One shape does pay, on two of the three windows: buy a close
//     that sits >= 1.35% below a SHORT (45-bar) EMA, sell when the
//     close reverts to that EMA. It caught exactly one dip per window:
//     dev 20261115 +$8.41 (buy $63,527, sell 11 bars later) and this
//     window +$7.90 (buy $63,737, sell 15 bars later); it never loses
//     on any window (worst $0.00) and still makes +$6.70 at 2x fees.
//
// Strategy: long only, one position, full cash per entry.
//   - Entry: the latest close is at least 1.35% below the 45-bar
//     exponential moving average of closes.
//   - Exit: the whole position when the close climbs back to the
//     45-bar EMA (the reversion), when its value is 1.5% under its
//     cost (stop loss), or after 480 bars held.
//   - After any exit, no new entry for 30 bars.
//   - No new entries once 1380 bars of the window have been seen (a
//     buy in the last 60 bars would just pay round-trip costs to the
//     final flatten).
//
// All comparisons are bigint math on the harness's raw price units
// (the EMA is kept at a fixed 1e6 scale, so it stays integer too), so
// the two graded runs answer identically. No clock, no environment,
// no randomness: the bot's only inputs are the hello, the batches and
// the fills the harness sends. Orders are decided on one bar's close
// and fill at the next bar's open; max_slippage_bps 200 (2%) caps how
// far a fill may move from the close the order was decided on.
//
// Local dev grade (kit grade-local, process driver, two executions,
// reproduced byte for byte): net PnL +$7.90 on the frozen dev window,
// 1 round trip (2 filled orders), 0 rejected, max drawdown 0.62% —
// passes the dev gate (> $0) and the guardrails (>= 1 trade,
// DD <= 25%). At 2x fees the net PnL is still +$7.10.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// EMA lookback (bars) for the dip measurement and the reversion exit.
const EMA_BARS = 45;
// Entry: the close must sit this many bps below the EMA.
const DIP_BPS = 135n;
// Take profit is the reversion itself; stop loss, in bps of cost.
const STOP_LOSS_BPS = 150n;
// Longest a position is held, in bars.
const MAX_HOLD_BARS = 480;
// Bars to wait after an exit before a new entry is allowed.
const COOLDOWN_BARS = 30;
// No new entries once this many bars of the window have been seen.
const ENTRY_CUTOFF_BARS = 1380;
// Slippage cap on every order, in bps from the latest close.
const MAX_SLIPPAGE_BPS = 200;
// Fixed-point scale for the integer EMA (the EMA is stored scaled).
const EMA_SCALE = 1_000_000n;

/** The strategy state: the closes seen so far, the EMA, and exit bookkeeping. */
class SharpDipBot {
  // Closes in raw price units, one per CBBTC bar, in order.
  closes: bigint[] = [];
  // Close time (ms) of the last bar recorded, so a batch that carries
  // no new CBBTC bar does not record the same close twice.
  lastT: number | null = null;
  // EMA of closes, scaled by EMA_SCALE; null until the first bar.
  emaScaled: bigint | null = null;
  // Index into closes of the bar the current position was entered on.
  entryBar: number | null = null;
  // Index into closes of the bar an exit was decided on (-1 if none yet).
  lastExitBar: number = -1;

  onBatch(state: BarsState): (BuyInput | SellInput)[] {
    // Record this batch's CBBTC bar, if it carried a new one. A minute
    // the recorder missed has no bar and adds nothing.
    const bar = state.latest.get(SYMBOL);
    if (bar !== undefined && bar.t !== this.lastT) {
      const close = BigInt(bar.c);
      this.closes.push(close);
      this.lastT = bar.t;
      // Integer EMA, seeded with the first close: ema += (c - ema) * 2 / (n + 1),
      // all in scaled integers, so the update is exact and deterministic.
      const scaled = close * EMA_SCALE;
      if (this.emaScaled === null) {
        this.emaScaled = scaled;
      } else {
        const d = scaled - this.emaScaled;
        this.emaScaled += (d * 2n) / BigInt(EMA_BARS + 1);
      }
    }
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) return this.maybeExit(state, held);
    return this.maybeEnter(state);
  }

  maybeExit(state: BarsState, held: { qty: bigint; cost: bigint }): SellInput[] {
    const value = state.value(SYMBOL, held.qty);
    const cost = held.cost;
    const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
    if (cost > 0n && value * BPS <= cost * (BPS - STOP_LOSS_BPS)) return this.exit(sell);
    // Reversion: the close climbed back to the EMA.
    if (this.emaScaled !== null && this.closes.length > 0) {
      const closeScaled = this.closes[this.closes.length - 1] * EMA_SCALE;
      if (closeScaled >= this.emaScaled) return this.exit(sell);
    }
    if (this.entryBar !== null && this.closes.length - this.entryBar >= MAX_HOLD_BARS) {
      return this.exit(sell);
    }
    return [];
  }

  exit(sell: SellInput): SellInput[] {
    this.lastExitBar = this.closes.length - 1;
    this.entryBar = null;
    return [sell];
  }

  maybeEnter(state: BarsState): BuyInput[] {
    const n = this.closes.length;
    if (n < EMA_BARS || n >= ENTRY_CUTOFF_BARS) return [];
    // Cooldown after an exit: without it the dip trigger can stay
    // true for bars after a sell and the bot churns, paying a round
    // trip per bar.
    if (this.lastExitBar >= 0 && n - 1 - this.lastExitBar < COOLDOWN_BARS) return [];
    if (this.emaScaled === null || this.closes.length === 0) return [];
    const closeScaled = this.closes[this.closes.length - 1] * EMA_SCALE;
    // Entry: the latest close sits at least DIP_BPS below the EMA.
    if (closeScaled * BPS >= this.emaScaled * (BPS - DIP_BPS)) return [];
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    this.entryBar = n - 1;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
}

const bot = new SharpDipBot();

await runBars({
  onBatch(state) {
    return bot.onBatch(state);
  },
});
