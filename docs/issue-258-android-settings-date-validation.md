# Issue #258: first settings/date interaction batch

## Baseline and scope

- Source baseline: main `12c456aa29e6a6542a6e8f9a8b27d164d23181fc` (#271), verified through the read-only GitHub commit API on 2026-10-25.
- Isolated repository: `/Users/adlin/Documents/Codex/2026-10-25/task-3/DietDigiDose`; branch `fix/258-android-settings-date`.
- Read repository `AGENTS.md`, root layout, Screen keyboard boundaries, global tokens, existing settings, date component/callers and tests. Repository `.agents` does not exist; `/Users/adlin/.agents/skills` is empty.
- Baseline code: seven reminder TextInputs; three settings Modals without `onRequestClose`; SmartDateInput height 52 with one-line value; inventory entry overrides height to 46. Brand Switch and date theme support already existed.
- No Android APK/device baseline or before/after screenshots available. The current UI inventory has no project preview or Android simulator. Per task restriction, no localhost server/listener was started, no alternate port/route attempted, and no escalation requested. Earlier task's EPERM restriction remains in force.

## Changes and choices

- Reuse SmartDateInput for the seven reminder times: Android native time picker, 24-hour display and HH:mm values; Web native `input[type=time]` with valid-time conversion. Time changes remain draft edits until existing save actions; brand Switch behavior and colors remain.
- Use wrapping field columns (140-point basis), readable labels, minimum rather than fixed input heights, wrapping native text, and explicit accessible field names. Remove inventory's fixed-height override and tiny batch-date label override. Unknown/estimated date evidence and inventory business rules are unchanged.
- Keep the existing native picker without an extra native modal wrapper. Cancel never emits a date; synchronous guards reject repeated open/confirm, stale picker callbacks and disabled/unmounted results. Calendar output format remains YYYY-MM-DD for existing callers.
- A settings-local Modal layout reuses RN Modal, KeyboardAvoidingView, ScrollView, safe-area insets and existing theme classes. Back, backdrop and explicit cancel share close handlers. Destructive verification is cleared on cancel; in-flight writes lock closing. Hot calorie controls have token-sized touch targets. Keyboard dismissal is explicit on closing/saving; content can scroll.
- Reminder reads have a loading/error/retry state. Invalid times and calorie input errors are inline. The calorie range remains 1000–5000; an invalid numeric suffix is no longer silently truncated. Synchronous per-operation locks and page/session ownership guard save/read races. Reminder write-through-schedule locks are held in a settings-local module keyed by user ID and auth generation, and survive both blur and actual unmount/recreation. A new instance waits for pending save/scheduling completion (or failure) before reading server preferences and enabling edits. Successful reminder writes finish scheduling only for the still-current account.
- No dependency, environment/signing configuration, comments keyboard (#17), phone-binding implementation (#270), notification business rules, backend or unrelated page changes.

## Verification on Node 22.23.2

Existing dependencies copied into this workspace from the prior task, after confirming identical pnpm lockfiles. No installation performed. Commands run from `client` unless otherwise noted; PATH uses `/Users/adlin/Documents/Code/Dietdigidose-local/node-v22.23.2-darwin-arm64/bin`.

| Check | Result |
| --- | --- |
| `jest --runInBand` | PASS: 116 suites, 812 tests |
| `tsc --noEmit` | PASS |
| `eslint ./ --quiet` | PASS |
| `CI=1 EXPO_OFFLINE=1 expo export --platform web` | PASS; static export only, no APK |
| Root `node scripts/check-module-boundaries.mjs` | PASS |
| `git diff --check` | PASS |
| Client Web budget, using existing `quality/build-budgets.json` limits | PASS: total 6,158,241 / 6,500,000 bytes; JS 4,350,026 / 4,500,000; largest JS 1,234,918 / 4,100,000 |

Regression coverage includes native picker open/dismiss/confirm/repeat/stale/disabled/unmount and date formatting; light/dark theme properties; Web valid/invalid/clear/recovery; growing layout properties; calorie reread/cancel/back/validation/failure/retry/double-write/late read and save/blur-re-entry locks; reminder draft/save/failure/double-write/re-entry reread; deletion verification cancellation; keyboard/scroll configuration. Full suite also includes Screen, post-detail keyboard, PhoneBindingSettings, AccountSmsVerification and existing inventory evidence tests.

Logs outside the tracked repository: `../client-tests.log`, `../client-tsc.log`, `../client-eslint.log`, `../web-export.log`, `../architecture.log`.

## Limits and review handoff

- Component mocks verify callback/state contracts and layout properties, not real Android rendering, native focus, accessibility traversal, contrast, keyboard overlap, system font scaling or safe-area positioning. Android native theme rendering (including forced app theme versus system theme) remains unverified.
- Same-device light/dark/large-font screenshots, actual hardware back/native cancel interactions, landscape/keyboard/safe-area touch checks and browser visual regression remain pending. Web export and native-input component tests are not browser/Android visual evidence.
- No iOS build/device test, APK build, backend/admin builds or server integration tests run; those implementations are unchanged. Full-repository build budget script requires unrelated server/admin build outputs, so only the affected client budget was checked.
- Initial `git fetch origin main` failed with `Could not resolve host: github.com`. No retry/escalation was used; the read-only connector verified main and the complete commit already existed in the local clone.
- Independent review of `a07a2a9` found one P2: the component-local reminder lock allowed a new mounted instance to save/schedule before an older response, after which old scheduling could win. The follow-up fix coordinates the entire write-through-schedule operation across instances and preserves scheduling for a successful same-session write after unmount. The original reviewer independently rechecked `c78b01ef6498454c4b64b4ca9fefcbc7e50e34a1`, closed that P2 and found no new blockers; this does not close the pending visual/device acceptance items. No push, PR, merge, deployment, Issue edits, real SMS, paid API calls or real device data operations were performed.


## Independent review follow-up

- Supplemental test-only source commit `b87992f55c6bba2287e8e2d8541df7145eea13f0` from task-5 was reviewed and cherry-picked as `e0b666c`. It adds native time draft/save integration, stale reminder-read handling and inventory unknown/estimated/confirmed date evidence regressions. No source workspace was modified.
- The task-4 review report is `/Users/adlin/Documents/Codex/2026-10-25/task-4/review-258-a07a2a9.md`. Its actual unmount/create race is covered with the corrected expectation: a recreated form remains disabled through both delayed HTTP response and delayed native scheduling, rereads the committed 09:00, then accepts 10:00. Schedule order is 09:00 then 10:00, never the reverse.
- Additional cases verify a lone successful request still schedules after unmount, a failed pending request releases the lock and permits reread/retry, and switching from account A/session 4/token A to B/session 5/token B lets B save while A's late response cannot schedule.
- Full client regression after the fix: 116 suites / 809 tests PASS. The final strengthened A-to-B account-switch test was additionally rerun with the 16-test settings suite; TypeScript and full client ESLint were rerun. Web export, client budget and architecture checks passed again. These are still mock/native-property checks, not real-device verification.


## Final independent review and retained edge regressions

- Read-only review report: `/Users/adlin/Documents/Codex/2026-10-25/task-4/review-258-c78b01ef.md`; the reviewer independently passed 7 related suites / 84 tests on the frozen implementation, then 19 settings tests after adding three edge cases in the isolated snapshot.
- Those three cases are now retained in this branch's `client/screens/settings/index.test.tsx`: native scheduling failure releases the remounted form for retry; reauthentication of the same user creates a separate session lock and ignores the old response; logout without a replacement settings instance prevents late scheduling.
- Final full client test run: 116 suites / 812 tests PASS (including all 19 settings cases). Full client TypeScript, ESLint and diff checks pass. This final retention change affects only tests and this validation record; product implementation stays exactly at reviewed `c78b01ef`, so the successful Web export, budget and architecture checks above remain applicable and were not needlessly repeated.
- Independent code review is complete with no outstanding blocker. The visual, browser and Android/iOS device limitations above remain explicit and unchanged; no issue checkboxes or release actions were performed.


## PR CI budget follow-up

- Draft PR #272 initially used head `993dc26f0bd955627e8575a74effc2aaad600dc7`, whose tree is identical to local `8b7e16e`. The four unpublished commits had only author/committer emails changed to the verified `67130535+AdlinZ@users.noreply.github.com` after GitHub GH007 rejected the first push; email protection was not changed and no force push was used.
- CI run `40186818810` reported Windows client JS 4,500,998 bytes, 998 over the unchanged 4,500,000 limit. Windows tests and builds passed; the failure was the final budget gate. Local macOS output was smaller, so local budget success did not establish Windows budget success.
- The necessary fix only hoists 14 repeated static className strings within the settings page. It preserves every expanded class string and all render/interaction logic, with no dependency or budget changes. Local Web JS is reduced by 1,632 bytes to 4,350,026; total export is 6,158,241 bytes. Independent read-only review passed: expanding all 14 constants at 50 use sites is byte-for-byte identical to the prior source; the existing Tailwind Oxide scanner retained all 39 extracted style tokens with no candidate loss. The new exact-head CI remains the authority for Windows acceptance.
- After this fix, all 116 suites / 812 tests, full client TypeScript/ESLint, Web export, architecture and diff checks passed again. Visual/device limitations above still apply.
