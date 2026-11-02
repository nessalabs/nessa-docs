# Optional rule checking

A statechart page can link a TLA+ model. A button in the app, and the MCP tool
`check_model`, run TLC on that model and save the result in the page. Pages
without a model open and validate exactly as they do today. The checker is
never required.

This checks a model of the design. It does not run the documented program, and
a rule that holds here is not evidence that the code matches the chart.

## What is stored

The model is a real `.tla` file and a TLC `.cfg` file under `docs/state/tla/`,
mirroring the page path. The page links them in frontmatter (`model.spec`,
`model.config`) and may name plain-language steps (`model.steps`). The last
finished check is `modelCheck` in the same frontmatter: the page's source
checkpoint, the checker version, the date, the config path, a digest of the
spec and config bytes, the state count, rules held, rules broken with a
plain-language path, and rules not checked.

Those files and the result are committed with the page. TLC and Java are not.
They download into a per-user cache and are reused when the pinned checksums
match. The cache never sits inside the documented project.

| Platform | Cache |
| --- | --- |
| macOS | `~/Library/Caches/nessa-docs/tlc/<version>/` |
| Linux | `${XDG_CACHE_HOME:-~/.cache}/nessa-docs/tlc/<version>/` |
| Windows | `%LOCALAPPDATA%\nessa-docs\Cache\tlc\<version>\` |

`NESSA_DOCS_TLC_HOME` replaces the `tlc` directory. The version segment stays.

Pins for this release: TLC 1.7.4 (`tla2tools.jar`) and Eclipse Temurin 21.0.13+9
JRE for macOS (arm64 and x64), Linux (arm64 and x64), and Windows x64. Each
download is checked against a SHA-256 recorded in `server/model-check/pins.ts`
before it is extracted or run. A checksum mismatch is deleted and is not
executed. An offline machine with a verified cache reuses it. An offline
machine without one stays not installed and says so.

## How a run finishes

TLC runs in a temporary directory, one worker, on a copy of the spec and
config. It does not write the checker, or its state files, into the project.
Each named `INVARIANT` and `PROPERTY` is a rule. When a rule breaks, that rule
is removed and TLC runs again, so later rules can still be checked. A run is
bounded: 2,000 distinct states and 20 seconds. Hitting either bound stops the
process.

A rule is **held** only when a run that still included it finished inside the
bound and TLC reported no error. A rule is **broken** only with the numbered
path from that run's counterexample. Any rule still listed when the bound,
the timeout, or a cancellation stops the run is **not checked**. Not checked
is never reported as held. A TLC parse or runtime error is **failed** and does
not rewrite `modelCheck`. Cancellation does not rewrite it either. A finished
pass, break, or not-checked run writes `modelCheck` and leaves the previous
result in place only when the new run did not finish.

The recorded `sourceRevision` is the page's own source checkpoint when it has
one, otherwise the documented repository's `HEAD` when that is a full commit
id. The badge reads "Rules checked at <short id>". It is stale when that id
and the page's current checkpoint differ, or when the spec or config bytes no
longer match `modelDigest`.

Broken chart states are the diagram node ids that appear as values in the last
state of a counterexample. `model.steps` turns TLC action names into the
sentences stored on the path. Selecting a marked state shows the rule and that
numbered path.

## Check run

| State | What is true | What happens next |
| --- | --- | --- |
| Not installed | No verified cache for the pin | Download, or stay here when offline or the user declines |
| Downloading | A fetch is in progress; nothing is executed yet | Ready after checksums match; failed if the download or checksum fails; not installed if cancelled |
| Ready | Jar and Java match the pins | Running when a check starts |
| Running | TLC is in progress for one page or one spec/config pair | Passed, broke, not checked, failed, or cancelled |
| Passed | Every rule was held and none were left unchecked | Ready; `modelCheck` saved |
| Broke | At least one rule has a counterexample path; other rules may be held or not checked | Ready; `modelCheck` saved |
| Not checked | The bound or timeout stopped the run, no rule broke, and at least one rule was not finished | Ready; `modelCheck` saved, with those rules listed as not checked |
| Failed | Install or TLC could not complete; no rule from this run is held | Ready if a good cache remains, otherwise not installed; previous `modelCheck` kept |
| Cancelled | The user or the host stopped the run | Ready or not installed; previous `modelCheck` kept |

## Invariants

1. Opening a project and `validate:docs` never download TLC and never require a model.
2. A linked spec and config must exist under `docs/state/tla/`, and each file is linked by exactly one page.
3. The checker process writes only under the cache (for install) or the temporary run directory (for TLC). The only project write is `modelCheck` on the page that was checked, after a finished pass, break, or not-checked run.
4. A cache is reused only when the jar checksum matches the pin. A mismatch is not executed.
5. Held, broken, and not checked partition the rules of the config that was run. A rule is in only one of them.
6. A broken rule has a non-empty plain-language path. A held rule has no path.
7. The app button and `check_model` call the same runner and return the same result shape.
8. A missing checker is a visible not-installed state with an install action. It is not an empty success and not a pass.
9. The button, the badge, and the tool text say the model checks the design, not the code.

## Alternatives

Bundling a Java runtime in this repository, or in the documented project, was
rejected. The binary is large, platform-specific, and would land in git. A
pinned download in a user cache keeps the project limited to the model and the
result.

Apalache was rejected. It is a different checker with a different setup. The
request is TLC, and the saved files need to open in ordinary TLA+ tools.

Quint was rejected. It is a different language. The storage decision is a
`.tla` file plus a TLC config, not a Quint module embedded somewhere else.

Spectacle was rejected for this change. An in-browser interpreter could later
preview a model. It is not the checker of record, and it would not produce the
saved TLC result.

Embedding the model in a fenced block inside the page was the original sketch.
It loses because a real file is what TLC and TLA+ editors already open, and
because `validate:docs` can then check that the link exists and is unique. The
result stays in the page frontmatter so the chart can show it without running
TLC again.

## Review brief

Confirm a page with no `model` field is unchanged in the catalog, the browser,
and MCP. Confirm `validate:docs` fails when a linked file is missing or when
two pages share a spec or a config, and passes for the example store.

Confirm the cache path, the pin, and the checksum tests: reuse does not fetch,
a bad checksum is not executed, and an offline miss stays not installed.
Confirm the runner tests: a clean TLC report holds every rule, a violation
becomes a broken rule and the following run can hold the rest, a state bound
leaves the remaining rules not checked, and cancel writes nothing.

Confirm the example attachment model passes, and that deleting the write guard
makes `NoWriteAfterClose` break with a path. Confirm the chart marks that
state, the badge sits beside the source checkpoint, and Health shows the
checker version, cache path, and an install button when the cache is absent.

Out of scope: Apalache, Quint, Spectacle, checking the code itself, and the
agent skill that writes models. That skill change belongs in `nessalabs/skills`.
