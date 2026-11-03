# Reader-quality skill evaluation

This record concerns the authoring skill, not a change to renderer behavior.
The checks are agent reader exercises and source reviews, not a human usability
study or proof that every page is clear.

## Baseline: Nessa Agent

The sample came from the 173-page atlas introduced in
[PR 1256](https://github.com/nessalabs/nessa-agent/pull/1256): backup restore and
native product submission owners. A docs-only reviewer started at the root and
answered cancellation, partial restore and test-evidence tasks. A separate
source-aware reviewer checked the Rust/Swift boundaries.

| Observed problem | Skill change supported by the observation |
| --- | --- |
| Dense unexplained handoff, drain and proof vocabulary | Lead with observable task and define a necessary term at first use. |
| Restore error could be read as safe retry or no live effect | Explain remaining effects, consumed authority and supported next decisions. |
| Worker close could be mistaken for app kill/restart behavior | State the exact lifecycle and platform boundary of the claim. |
| Historical probe execution contradicted by broad not-run prose | Give one consistent evidence account; link historical results as historical. |
| Current evidence hidden behind an older receipt link | Test navigation from the root, not just an isolated page. |

[PR 1265](https://github.com/nessalabs/nessa-agent/pull/1265) corrects the sampled
pages and includes the repeat-task review. Six repeat reader tasks and source
reconciliation found the material issues resolved. This was a repeat review by
a source-aware reviewer, not a new independent novice. The catalog accepted 173
pages without issues; Chrome rendered 209 figures. No TLC or implementation tests
were rerun for those prose corrections; historical checkpoints were preserved.

## Transfer pilot: Shepherd

Source reviewed: `e56c5e583793ad7d69b4dd4738857909ca8007ad`. The first draft had 14
pages. Separate docs-only and technical reviews examined background task stop,
service survival/adoption, bounded output and current evidence. The author then
applied the revised skill, and affected tasks and source checks were repeated.

| First-draft failure | Verified correction |
| --- | --- |
| `cancel()` sounded as though it returned cleanup evidence | Explicit cancel, then wait, then inspect result; complete example compile-checked. |
| Service handle drop, explicit Leave and supervisor shutdown were ambiguous | Source-grounded outcome table and orderly restart sequence; abrupt exit excluded. |
| Ordinary output capture prerequisite missing | Capture opt-in, default Discard, automatic task capture and kept-process rejection separated. |
| Closed flags could be read as normal EOF | Explain aborted-reader errors and checking loss/errors separately from exit. |
| Kept record disappearance could imply all descendants gone | Separate leader exit, record fate and unverified remaining group members. |
| Important warnings hidden in Details when default view showed only chart | Add meaningful node details and owner navigation; shorten sidebar titles. |

The technical second pass closed these findings and corrected service stop edges
to match actual published status. Independent model review also separated two
uncorrelated kept-record scenarios, clarified the supplied adoption eligibility
assumption and added a missing semantic negative control. Final checks: 14 catalog
pages, zero issues; 10 diagrams rendered in Chrome; five models and 13 expected
negative-control failures; 123 actual Rust unit tests; public example typechecked.
The example was not executed. Cross-platform, privileged cgroup and stress suites
were not claimed. A model pass is not Rust conformance evidence.

## Fresh authoring test: Nessa iOS

A separate author used the revised skill with source revision
`8a027f07ecc1b27fb63502852648cb467e308720` and its inventory, without copying
Shepherd prose. The resulting atlas has 29 pages and 15 diagrams. A separate
reader agent followed root navigation before inspecting source for uncertain
send/retry, desktop switching, swipe deletion/restart, local Forget versus remote
revocation, and attachment/dictation cancellation.

Three task answers were supported on the first pass. Two needed more detail:
normal Send conditions after switching desktops, and the visible effect/control
for cancelling dictation or attachment preparation. Source-backed additions
answered both on the second pass. The review is an agent exercise, not human
user research; the repeated reader was not unfamiliar with the first draft.

Independent source review also corrected an overly broad pairing cancellation
claim: the actual checkpoint precedes asynchronous record load/save, so later
cancellation can still be followed by a successful save. Independent model review
found an outbox control that altered both send count and a synthetic failure flag.
The corrected invariant compares actual send counts across recovery, and the
mutant changes only that effect. The fresh final run passed eight models,
seventeen invariants and seventeen expected semantic control failures.

The existing implementation verification ran 425 Swift tests plus build and
architecture/design checks on macOS. Chrome opened all pages and rendered all
15 diagrams; focused inspector checks confirmed consequential explanations were
accessible from the normal diagram view. Neither renderer checks nor the models
prove phone UI, deployed gateway or physical-device correctness.

## Further transfer: Nessa UI

The fresh UI atlas distinguishes host-owned delivery and authorization from
component behavior. Six docs-only tasks covered queue closure, rendering timeout,
file changes, shared overlays, approval exit and transcript replay. Source review
supported those answers. Model review found an extra admission guard: after a
rendering timeout, the model still blocked new work merely because the underlying
render remained active. The implementation instead releases the queue wait and
relies on quarantine. Removing both model guards could fail before the timeout,
so that control did not isolate the intended failure window.

The author separated queue-link ownership from the underlying Promise and changed
the control to remove only quarantine admission. Final control evidence and review
closure are recorded in the UI atlas. This observation added two general checks
to the model-review reference: find accidental extra enforcers, and inspect whether
a counterexample reaches the intended failure window. This is a model-fidelity
improvement, not a claim that prose tests establish implementation correctness.

## Result and remaining scope

The revised skill now requires task-first explanations, locally defined terms,
concrete failure/next-step meaning, consistent evidence, reader tasks and a
separate source-fidelity pass. Rendering is tested as a reading surface, not
merely Mermaid syntax. The model review requirement remains separate and mandatory
when model verification is claimed.

The reviewed samples found and resolved material misunderstandings across these
repositories. This does not certify perfect prose or every future atlas. Further
rollout should apply the same checks and change the skill only for demonstrated
reusable failures, not accumulate project-specific checklists.
