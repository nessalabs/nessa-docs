# Package boundaries

Nessa Docs keeps authored Markdown in the user's project. The separate local
website reads it and renders diagrams. It has no dependency on the Nessa agent
backend and does not execute the described state machines. An optional TLC
check runs a TLA+ model linked from a page. It does not run the documented
program, and pages without a model skip it.

## Owners

| Area | Owns |
| --- | --- |
| `skills/nessa-docs/` | Agent instructions and the repository document format |
| `shared/` | Markdown structure and API data types shared by reader and server |
| `server/document.ts`, `catalog.ts`, `diagram-details.ts` | Metadata, hierarchy and target validation |
| `server/project-config.ts` | The optional `docs/state/nessa-docs.yaml`: card styles, reference patterns, note folders, authoring rules |
| `server/references.ts` | Where each reference pill on a page points, and the preview its peek shows |
| `shared/references.ts`, `shared/cards.ts` | How text is split into pills and which card a chart gets; the server and the browser both call these |
| `server/files.ts` | Local filesystem adapter for the injected repository-files port; checks reads against the catalog's accepted documentation boundary |
| `server/path-containment.ts` | The path-containment rule used by the catalog, file reader and link resolver |
| `server/project-opening/` | Validate chosen folders, retain opened project contexts, supply the local folder chooser, and compose the headless checker |
| `server/model-check/` | Optional TLC install, bounded rule checks, and the saved `modelCheck` record. See [rule checking](model-check.md) |
| `server/http.ts`, `main.ts` | Local HTTP transport and process composition |
| `src/project-opening/read-port.ts` | Framework-independent project source, read contract and outcomes |
| `src/project-opening/selection.ts` | Checks that a current-project answer belongs to the requested project |
| Other `src/project-opening/` files | Welcome flow and React read-context wiring |
| `src/api.ts` | Local HTTP implementation of the reader's project port |
| Remaining `src/` | Browsing, Markdown presentation, diagram canvas, inspector and settings |
| `vendor/nessa-ui/` | The small licensed UI subset; provenance in THIRD_PARTY_NOTICES |
| `examples/store/` | A small source-backed documentation example |
| `fixtures/` | Controlled projects used to verify supported and refused content |
| `scripts/development/` | Vite's local proxy adapter, using the server's request-admission rule |
| `verification/` | Real browser journeys and measurements |

Opening a folder creates a project handle. The URL selects that handle and the
frontend supplies it to its read port. Project state is scoped to that context;
the Markdown renderer and Mermaid canvas do not select filesystem roots. A host
integration can replace the opening adapter while keeping the reader contract.

The initial local adapter targets macOS and Linux. Repository-relative Markdown
paths use `/`. Native Windows support needs its physical-path and filesystem
behavior handled separately, rather than changing the Markdown path contract.

Folder selection belongs to the project-opening adapter. The macOS adapter opens
the native chooser; other supported hosts use path entry for now. Selecting a
folder fills the field. Catalog validation remains the owner of opening it.
A future host supplies its own chooser without changing Markdown rendering.

The catalog supplies the accepted `docs/state` boundary when it requests a file.
The local adapter checks the file's canonical path and identity around the read.
It refuses content when those checks show a changed file or an escaped path.
A later reload can retry an ordinary file replacement. These checks do not make
an atomic snapshot or prove confinement against every coordinated filesystem race.

The format reference inside the skill is the documentation owner of metadata.
The parser is its implementation. Other guides link the reference instead of
declaring another schema. `parent` metadata owns hierarchy; a separate manifest
would create another navigation authority.

A reference pill is resolved by the server, like a link. The browser splits
text with the same function the server used and looks each pill up by its
rule and text; it never builds a target. A pill may show a Markdown file outside
`docs/state` only when the project config lists that file or its folder under
`notes`; every other repository path is still only checked for existence.

Mermaid rendering runs serially because the library keeps global state.
The canvas handles navigation and presentation after SVG rendering. Markdown
bindings, rather than inferred labels, decide which element has depth.

## Optional MCP Apps adapter

`server/mcp` composes the catalog with a closed, in-memory RepositoryFiles
adapter and a stdio MCP server. Its optional `durable-store.ts` adapter stores
only generated Markdown in an explicitly selected private directory, with one
manifest and a drained exclusive writer lock. Memory mode remains the default. `src/mcp` uses the existing Markdown/diagram
renderer with host-owned navigation and the standard MCP Apps bridge. The
standalone filesystem/HTTP composition is independent. `shared/mcp-payload.ts`
validates the structured payload at both sides of the protocol boundary.

See [MCP Apps](mcp-app.md) for the tools, revision transitions, sandbox contract,
current host-verification limits and future authenticated remote boundary.
