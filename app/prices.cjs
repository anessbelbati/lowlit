'use strict';
// What tokens cost at Anthropic's API list prices, in dollars per million, as
// platform.claude.com/docs/en/about-claude/pricing gave them on 3 Oct 2026:
// fresh input, written to the cache for 5 minutes, written to it for an hour,
// read from the cache, output. A Max plan does not charge these: they measure
// how much was used.
//
// A chat's cache is written for an hour and a subagent's for 5 minutes: on
// 3 Oct the 49 chats of the last 9 days held only the first kind and the 87
// subagents only the second. The counts on disk keep the two together, so the
// kind of transcript says which price its writes take.

const PRICES = [
  ['claude-fable-5-1', 10, 12.5, 20, 0.25, 50],
  ['claude-fable-5', 10, 12.5, 20, 1, 50],
  ['claude-opus-5-5', 4, 5, 8, 0.2, 20],
  ['claude-opus-5', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-8', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-7', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-6', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-5', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-1', 15, 18.75, 30, 1.5, 75],
  ['claude-opus-4', 15, 18.75, 30, 1.5, 75],
  ['claude-sonnet-5-5', 2, 2.5, 4, 0.2, 10],
  ['claude-sonnet-5', 2, 2.5, 4, 0.2, 10],
  ['claude-sonnet-4-6', 3, 3.75, 6, 0.3, 15],
  ['claude-sonnet-4-5', 3, 3.75, 6, 0.3, 15],
  ['claude-sonnet-4', 3, 3.75, 6, 0.3, 15],
  ['claude-haiku-4-5', 1, 1.25, 2, 0.1, 5],
  ['claude-3-5-haiku', 0.8, 1, 1.6, 0.08, 4],
].sort((a, b) => b[0].length - a[0].length);

const known = new Map();

/** [fresh input, 5-minute write, 1-hour write, cache read, output] of a model, or null for one not on the list. */
function pricesOf(model) {
  const id = String(model || '');
  if (known.has(id)) return known.get(id);
  let found = null;
  for (const [key, ...p] of PRICES) {
    if (!id.startsWith(key)) continue;
    // "claude-opus-4" must not take "claude-opus-4-8": after the name only a dated release or a "[1m]" may follow
    const rest = id.slice(key.length);
    if (rest === '' || rest[0] === '[' || /^-\d{8}(\[|$)/.test(rest)) { found = p; break; }
  }
  known.set(id, found);
  return found;
}

/**
 * Dollars per token of each kind [fresh input, output, written to cache, read
 * from cache] for one model; null for a model not on the list. sub: a
 * subagent's transcript, whose cache writes last 5 minutes.
 */
function rates(model, sub) {
  const p = pricesOf(model);
  return p ? [p[0] / 1e6, p[4] / 1e6, (sub ? p[1] : p[2]) / 1e6, p[3] / 1e6] : null;
}

module.exports = { pricesOf, rates };
