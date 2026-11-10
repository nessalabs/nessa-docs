# Decisions

Short architecture decisions for the example store. Pages in `docs/state`
refer to them as ADR-1, ADR-2 and so on.

## ADR-1 Callers save orders

The order code returns a new order and never saves it. Storage belongs to the
caller, so this example has no database and no lookup for a newer copy.

## ADR-2 Payment errors are not refusals

A provider error fails the submission. It is not treated as a refusal, because
an error does not prove that no charge happened.
