# Backend Implementation Methodology

Consult the sections that match the change. These are implementation decisions to resolve from the project's contracts and behavior, not a mandatory audit for every endpoint.

## Trace a complete operation

Follow one representative input through boundary validation, access enforcement, business decisions, effects, and response or acknowledgement. Inspect the actual components rather than assuming a particular layering scheme.

Locate related callers, fixtures, error handling, and test utilities before adding a parallel implementation. Identify whether the same operation is entered through a route, a worker, or another internal caller and where its invariant is enforced.

## Input, output, and access

Use established validators and serializers. Define whether unsupported fields are rejected or ignored according to the contract; neither behavior should happen accidentally.

For partial updates, distinguish a missing field from an explicit request to clear it. Validate values before effects and preserve domain-specific precision, timezone, and normalization rules instead of silently coercing them.

Scope resource queries and mutations to the authorized actor or tenant when that restriction applies. Verify that access restrictions cover direct requests and internal entry points, not only frontend controls. Do not expose whether an inaccessible record exists if the established contract intentionally hides that distinction.

For listings, preserve relevant filtering, pagination, and stable ordering. Apply access scope to the query that selects results; do not fetch an unrestricted dataset and rely on client filtering.

## Persistence and concurrency

Express the invariant before choosing the mechanism. For example, if the confirmed rule allows at most one record per external event identifier, concurrent deliveries must not create two records even if both requests initially observe no existing record.

Consider the project's uniqueness constraints, transactions, locking, or conditional writes and how their failure outcomes map to the contract. Test the persistence interaction when a mock would conceal the race or constraint behavior.

Keep dependent writes in the appropriate atomic boundary. Check whether they actually share the same transaction context. Include relevant failure cases so an early write cannot silently survive a later failure when all-or-nothing behavior is required.

When schema changes are needed, follow migration conventions and account for existing data and overlapping consumer versions where applicable. Do not assume that changing an already-applied migration changes an existing database. Distinguish schema rollback from recovery of changed or deleted data.

## Integrations and ambiguous outcomes

Identify the provider's accepted request, success response, errors, and duplicate-processing behavior from available contracts. Use test fixtures or a suitable test environment rather than assuming production behavior.

For a timeout after a request was sent, consider that the provider may already have performed the operation. Reconcile through an existing operation identifier or idempotency mechanism when supported; do not retry a payment or another non-idempotent effect blindly.

Define which failures are retryable, whether the operation is safe to repeat, and the stopping condition before introducing retries. Use bounded behavior consistent with project conventions and preserve actionable failure information.

A database rollback does not undo an external action. If recovery, reconciliation, or durable delivery is required, use the project's existing mechanism where possible and make any new mechanism proportional to the guarantee needed.

## Background jobs and events

Inspect delivery and acknowledgement semantics before implementing a consumer. Identify what marks completion, what happens after a crash, and whether a message can be delivered again.

Protect the relevant invariant across duplicate deliveries or partial progress. Acknowledge or report success at the point required by the actual delivery contract; do not erase a failure by catching it and returning success.

Preserve payload compatibility with existing producers and consumers. Add a queue, scheduler, or dead-letter mechanism only when needed for the requested behavior, not as a default scaffold.

## Node.js and Express projects

Use this section only when the inspected project uses this stack. Check its package manager, lockfile, module format, runtime requirements, framework version, and existing middleware and error conventions.

Trace promises and callbacks through the actual request or job path. Ensure operations whose outcome determines the response are awaited or otherwise completed through the intended control flow. Avoid unhandled background promises and responses sent twice from competing branches.

Verify how asynchronous exceptions reach the installed framework's error boundary instead of assuming behavior from another version. Follow established middleware ordering for parsing, identity, access, validation, and error handling as applicable to the route.

If expensive synchronous work or unbounded input could affect the requested behavior, inspect the actual workload and relevant limits before changing execution strategy. Do not add worker infrastructure solely because the runtime is Node.js.

## Choose tests at the failure boundary

Use a unit test for an isolated rule, a transport-level test for parsing or response contracts, and an integration test when correctness depends on persistence or another real boundary. Combine levels only when they verify different meaningful behavior.

For an ownership-restricted update, verify an allowed actor and a disallowed actor, including that denied writes leave data unchanged. For an atomic multi-write operation, verify that a relevant later failure does not leave an invalid partial state.

Use isolated fixtures and project-supported cleanup. Tests should not call live providers or mutate production data without explicit authorization for that environment.

State environment prerequisites and report unavailable checks as not run. A passing mocked test is not evidence that a database constraint, deployment, or external provider was verified.
