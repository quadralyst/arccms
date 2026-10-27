# Member PIN lock where the tries were made (F36)

**Status: agreed by Gunjan (2026-10-27, brief F36 from Arc POS) and built on `fix/member-pin-lock-here`.** A follow-up to F32 (`specs/sign-in-pin-spec.md`).

## The problem

`signInWithMemberPin()` counted a wrong try against the person's sign-in count, so the fifth wrong try at an app's shared screen (a till's "Who's serving?") locked their PIN sign-in on every device until Forgot PIN. Anyone at the counter could stop the owner that way. Not a way in, but an easy way to stop the business.

## What was built

| Rule | Value | Where |
|---|---|---|
| Wrong tries in a row on one rate key before the person is locked there | 5 | `MEMBER_PIN_TRIES_HERE` |
| Each lock on that rate key | 5 min, then 15 min, then 1 hour every time after | `MEMBER_PIN_WAITS_MS` |
| Refusal while locked there | `locked-here` with `retryAfter` (seconds); a right PIN is refused too | `memberPin.ts` |
| Wrong tries at app screens, every rate key together, before the account lock | 20 in a day | `MEMBER_PIN_TRIES_PER_DAY` |
| The sign-in page's own lock | 5 wrong in a row, unchanged; it also refuses the app screen (`locked`) | `accounts.ts` |
| A right PIN at an app screen | resets the count and the locks on its rate key only; the sign-in page's count is left alone | |
| A day with no wrong try on a rate key | resets that rate key's count and locks | |
| Forgot PIN (a new PIN) | resets everything: counts carry the PIN's salt fingerprint, and the day's total sits on the PIN record | |
| Per-caller limit | 30 wrong tries an hour per rate key across everyone, unchanged | `MEMBER_PIN_WRONG_PER_HOUR` |

Storage: `app_member_pin_tries/<uid>__<sha256(rateKey)>` (`uid`, `pinId`, `failedAttempts`, `strikes`, `lockedUntil`, `lastFailedAt`), closed in the rules, deleted with the account; the day's total is `appFailed` and `appFailedSince` on `auth_pins/<uid>`.

## Notes on the shape

- The numbers are fixed, not options: an app may stop earlier with its own count, never later. Five locks of growing length on one device would pass 20 tries, so one device alone reaches the account lock in about an hour and a half of steady guessing (5 + 5 + 5 + 5 wrong, with 5, 15 and 60 minute waits between).
- With the default rate key (the caller's address), every screen behind one shop router shares a key. Apps should pass a key per device, as Arc POS does.
