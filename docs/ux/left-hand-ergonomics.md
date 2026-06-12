# Left-hand & small-hand ergonomics — assessment

> Group D deliverable of `docs/superpowers/plans/2026-06-11-fable-todo-groups.md`.
> Covers two todo.md items: "reading articles with the left hand is awkward" and
> "swiping motions need to be rethought — small hands find the right-swipe back in
> article / reader mode challenging". This is an assessment, not a code change:
> gesture feel needs on-device validation, and blind changes risk making it worse.

## Current gesture map

| Surface         | Gesture                          | Action               | One-handed difficulty                                                                                                                              |
| --------------- | -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Digest pager    | horizontal page swipe            | day ↔ day ↔ settings | low — works anywhere on screen                                                                                                                     |
| Article overlay | right-swipe (anywhere)           | close                | **medium** — rightward thumb arc is cramped for left-hand grips                                                                                    |
| Article overlay | left-swipe (anywhere)            | open full article    | low                                                                                                                                                |
| Reader          | right-swipe from left-edge strip | back / close         | **high** — the strip hugs the left bezel; a left thumb must fold back onto its own base joint, and small hands can't reach it in a right-hand grip |
| Reader/article  | hardware back                    | back / close         | low — but Android-only muscle memory                                                                                                               |

## Why the right-swipe back is the pain point

- A right-swipe is an _abduction_ movement for the left thumb (pushing away from the palm) — weaker and less precise than the adduction (pulling inward) that a left-swipe is. For right-handed grips it's the comfortable direction, which is why it feels fine in testing with the right hand.
- The reader's left-edge strip compounds it: the gesture must _start_ at the bezel the left thumb is anchored next to, forcing a fold-back. With small hands and a right grip the strip is simply out of reach.
- Group D's larger thresholds (72 px distance / 0.6 velocity) make accidental triggers rarer but make the reach problem _slightly worse_ — deliberate swipes now need more travel.

## Candidate changes, ranked

1. **Bottom-corner back affordance in the reader (recommended first).** A small floating back button in the bottom-left _and_ bottom-right corners (mirroring), in thumb range for either hand. Cheap, no gesture conflicts, discoverable. The WebView keeps all surface gestures.
2. **Make the article-overlay close symmetric.** Allow close from a _left_-swipe when already at the leftmost scroll position, or add an explicit close button at the bottom of the article (the current ✕ is top-left — top corners are the worst one-handed zone on tall phones).
3. **Edge-strip width preference.** Expose the reader strip width (currently ~edge px) as a hidden/dev setting and test 24–32 px on-device with the user's actual grip before committing.
4. **Mirror mode (defer).** A "left-handed mode" preference flipping gesture directions and corner placements. Highest effort, splits muscle memory, and the data (one user) doesn't justify it yet.

## What was deliberately _not_ changed in code

Gesture direction semantics (right = back/close everywhere) stay, because they match platform convention (Android predictive back, iOS back-swipe are both left-edge → rightward). Breaking that for ergonomics would trade a reach problem for a convention problem. The fix is _reach_ (bottom corners, symmetric affordances), not _direction_.

## Suggested validation protocol

On a real device, left hand only, thumbs-only, three sessions: open digest → article → reader → back out, ten times. Note every grip shift. Repeat after implementing candidate 1. If grip shifts drop to ~zero, stop there; otherwise try candidate 2.
