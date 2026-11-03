# Required TLA+ model review

Use this procedure every time models are created, changed, refreshed against
source, or reported as verified. It is an authoring completion requirement;
the catalog validator and renderer do not enforce it. Prose-only edits that do
not change model meaning, source mapping, or verification claims need not rerun
TLC. State that existing results were not rerun.

## Establish scope and challenge the model

Inventory the in-scope owning pages, specs, configs, source revisions and shared
owners. For full-atlas verification, include all linked models. Record bounds,
environment assumptions, omitted behavior and whether properties concern safety
or liveness. Do not imply that a finite safety run establishes liveness.

Perform a distinct adversarial review against the actual owning source and tests,
not just the diagram or the model author's explanation. Use an independent
reviewer or subagent when available; otherwise perform a separate critical pass
and disclose that it was self-review. Give an independent reviewer the source,
model, config and claimed properties without prescribing the expected verdict.

Challenge at least these questions where applicable:

- Can cancellation, retries, stale callbacks, restart, duplicate delivery or
  competing owners reach states omitted by the model?
- Do authorization, effects, acknowledgements, persistence and cleanup happen in
  the order the implementation permits? Are identity and generation correlations
  independent enough to express stale or mismatched inputs?
- Are invariants meaningful and reachable, or true only because their antecedents
  never occur, failure states are excluded, or guards assume the desired result?
- Do finite bounds, fairness assumptions or environment restrictions hide the
  behavior being claimed? Is deadlock handling justified, including termination?
- Does a second guard or atomic step accidentally enforce a rule after its real
  owner has released it? Separate caller completion from underlying work when
  they can finish at different times.
- Does the abstraction match current code, rather than silently modeling a fix
  or an ideal design? Are implementation uncertainties visible in the docs?

Record findings, dispositions and evidence. Correct model or documentation errors;
keep source-observed product issues visible rather than changing the model to
conceal them. Re-review affected assumptions and properties after fixes. Do not
claim complete verification while material review findings remain unresolved.

## Run baselines and negative controls

1. Run each unmodified model with its actual config through the canonical TLC
   checker. Require the claimed rules to hold with no broken or unchecked rules
   and no timeout, state-limit stop or execution error. An unavailable checker is
   incomplete verification, not a pass.
2. Maintain reproducible negative controls for every in-scope model, with at least
   one meaningful control per model and controls covering its distinct critical
   safety claims. One token control does not establish coverage of all invariants;
   record which claims each control exercises and any remaining gaps.
3. For each control, deliberately weaken a relevant guard or correlation, or
   introduce a plausible bad transition. Keep the semantic invariant unchanged.
   Name the expected broken rule before running. A syntax error, unconditional
   false invariant, type error or unrelated failure is not a successful control.
4. Check mutants only in isolated temporary files or in-memory copies. Require
   the expected semantic rule to break and inspect its counterexample for the
   intended bad behavior. The trace must reach the relevant failure window; a
   failure before that window does not test it. Avoid weakening several independent
   protections together when the intended defect removes only one. Require no
   unchecked rules or resource-limit failures.
   A mutant that still passes is a finding: investigate reachability, bounds,
   mutation effectiveness and property strength before claiming completion.
5. After fixes, rerun affected baselines and controls against the final inputs.
   Never save a mutant as the authored model or overwrite its baseline result.

Keep control definitions or scripts in the documented repository so another run
can reproduce them. Use existing project runners when available. Do not invent
CLI options or imply that catalog validation executes TLC or negative controls.
If the project lacks a runner, add a small reproducible harness using its checker
interface and document the exact command. Downloading/installing a checker must
follow the environment's authorization rules; absence cannot waive the gate.

## Preserve evidence and report limits

Save the source revision, final spec/config digests, checker version, bounds,
commands, date, baseline results, expected/observed mutant failures, and review
findings with their resolutions. Identify the review method and distinguish
independent review from self-review. Link the evidence from the owning pages or
a shared verification report. Preserve source-checkpoint rules: a review receipt
does not justify advancing unrelated pages.

Let the canonical checker write `modelCheck` for unmodified models only, following
[the file format](format.md#optional-rule-model). Keep review and negative-control
evidence separately; do not invent frontmatter fields or hand-author a passing
checker receipt. Report model counts, control counts, exclusions and incomplete
checks separately. State clearly that TLC checked bounded abstractions and that
negative controls challenged those abstractions, not executable Rust, Swift or
TypeScript. Describe implementation tests only when they actually ran.
