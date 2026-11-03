# Quality: what is measured, what is promised, what is missing

The goal is to be a reference in every area that matters for a personal app that keeps private data. "Reference" here means one thing:
**a claim is only made when a test or a measurement that anyone can repeat backs it.** This page lists each area, the last measurement,
what already guards it in CI, and what is still open. It is rewritten when a number changes, not when it is hoped to.

Measured on 3 November 2026, Chromium 1243 headless, mobile profile (Lighthouse: slow 4G, 4× CPU slowdown), built app served by `vite preview`.
Only Chromium was available, so **Firefox and Safari are not measured** (see Compatibility).

| # | Area | Last measurement | Guarded in CI by | Open |
|---|---|---|---|---|
| 1 | Security | Vault, end-to-end cloud, post-quantum pairing, Trusted Types; browser test finds 0 of 27 names readable on disk with the vault on | `e2e:vault`, unit tests | Independent audit not done |
| 2 | Privacy | 0 requests to other origins across all screens, no trackers, no third-party fonts | `e2e:audit` | Behaviour with an AI key or cloud account is by design (their servers) |
| 3 | Data safety | Encrypted backups, backup into a folder (Chrome/Edge), iOS 7-day warning; **a write refused for lack of room is announced at once** ("Storage is full: the last change was not saved"), an early warning from 90 % of the allowance, one tap to back up or to clear what can be rebuilt | unit tests, `e2e:quota` | No crash-in-the-middle-of-a-write test; the real browser limit could not be reached in the test environment, so the refusal is simulated with the exact error a full disk raises |
| 4 | Speed | Lighthouse performance 0.64 → 0.80–0.83; blocking time 1360 → 60–170 ms; startup 333 → 339 KB gzip (the animation engine now loads after the first paint) | `npm run size` (budget 340 KB) | Largest paint 4.6 s on the throttled profile |
| 5 | Accessibility | axe-core (WCAG 2.2 AA) on 15 screens: 0 serious or critical issues after fixes (was 88 name mismatches and 16 contrast failures); keyboard reachable; no horizontal scroll at 320 px; animations stop with reduced motion | `e2e:audit` | Screen-reader pass by a person; 200 % text zoom |
| 6 | Usability | Not measured | none | A test with people who have not seen the app |
| 7 | Offline | Reload with the network off opens the app | `e2e:audit` | Update-while-open scenario |
| 8 | Compatibility | Chromium only | none | Firefox, Safari / iOS |
| 9 | Languages | 7; five are machine drafts not reviewed by native speakers | `i18n:check` | Native review |
| 10 | Code | 1349 tests; coverage 73.8 → 77.9 % statements, 66.1 → 69.5 % branches (the developer-only eval harness is not counted); the lock screen, the vault sheet, lists, bulk edit, duplicates, preferences, family, the year story and the graph now have tests | `test:coverage` with a floor (77 / 68 / 69 / 81) | Goal 85 %: the largest gaps are the capture screen, the person sheet, profile sections, the reserve import, voice control |
| 11 | Supply chain | GitHub Actions pinned by commit hash and kept current by Dependabot; `npm audit` clean at high severity | `npm audit`, signatures | Reproducible build check |
| 12 | Documentation | Security model, architecture, cloud, language guide | review | Threat model needs a "what we do not protect" table kept in step |
| 13 | Energy and memory | JS heap 10–50 MB with 300 rows per table; the year story's progress bar now runs in the browser (CSS) instead of a script on every frame, pauses when held or hidden, and does not advance by itself with "reduce motion" | unit tests | — |
| 14 | User rights | Full export, delete all, open JSON formats | unit tests | A test that the export restores byte for byte |
| 15 | Open project | Contributing guide, security policy, code of conduct | review | — |

## How to repeat the measurements

```bash
npm run build && npm run preview -- --port 4174 --strictPort &
BASE_URL=http://localhost:4174/ npm run e2e:vault      # nothing readable on disk, locked or unlocked
BASE_URL=http://localhost:4174/ npm run e2e:audit      # no foreign requests, no serious axe violation, opens offline
npx lighthouse http://localhost:4174/ --preset=perf --form-factor=mobile
npm run test:coverage
```

Lighthouse varies by ±0.03 between runs on the same machine; compare medians of three, not single runs.

## What changed because of the first measurement

- Animation engine split: components use the small `m` component and load the features after the first paint (`LazyMotion`).
- Secondary text colour raised from 40 % to 54 % opacity (contrast 3.3:1 → 5.1:1 on the darkest surfaces).
- Initials in avatars are drawn by CSS, so a button named "Nina Carter" no longer shows a different text ("NC") to assistive technology.
- `robots.txt` added; GitHub Actions pinned by hash with Dependabot.
- `happy-dom` (tests only) updated for a high-severity advisory.
