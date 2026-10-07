# Database Engineering Methodology

Consult the sections relevant to the change. Engine-specific behavior must be established from the installed version, project tooling, or applicable documentation rather than assumed from another database.

## Reconstruct the current state

Inspect schema definitions, migration history, application queries, and fixtures. When database inspection is available and authorized, compare relevant metadata and migration state with the repository instead of treating either as complete proof of the other.

Record drift that affects the change. Do not reset an environment or regenerate migration history merely to make the definitions agree.

Use aggregate or narrowly scoped inspection where possible. Report counts, schema facts, and redacted examples instead of dumping private records or connection credentials.

## Translate business invariants into schema decisions

Define what makes a record distinct and which relationships must always hold. Check whether uniqueness is global, tenant-scoped, conditional on state, or dependent on normalization.

For a tenant-owned relationship, verify whether the actual schema enforces the required tenant consistency as well as the existence of the referenced record. Do not assume that an ordinary foreign key enforces every ownership rule.

Inspect how the engine treats nulls, case comparisons, and collations before claiming a uniqueness rule is enforced. Check the role of defaults separately from validation; a default does not necessarily prevent explicit invalid input.

Use established precision and timezone rules for money and time. Keep storage semantics and display formatting distinct. Ask about missing material policy rather than selecting a convenient numeric or temporal representation.

## Migrate existing data and contracts

Identify the prior schema, existing records that may conflict, affected consumers, and whether application versions overlap. Include only the transition complexity these conditions require.

For a new required field, determine how old records acquire a valid value and what existing writers do during the transition. A staged change may add the field, adapt writers, backfill, validate, and enforce the final constraint. A fresh unreleased database may need a simpler change.

For a rename or removal, inspect readers, writers, views, triggers, policies, and generated types that actually depend on the object. Do not drop the old representation while a required consumer still uses it.

Check supported DDL transaction behavior, lock acquisition, table rewrites, and index-building options when they influence the change. Do not promise a nonblocking migration from SQL syntax alone.

Migration retry behavior must match the runner and operation. An existence guard should not silently accept an object whose definition differs from the required schema.

## Backfill or repair with explicit postconditions

Specify which records are in scope, how each value is derived, and what invariant must hold afterward. Identify invalid source data before transforming it. Ask about conflicts whose resolution changes business meaning.

When data volume or concurrent writes warrant batching, choose stable progress tracking and define how interruption, repeats, and records written during the backfill are handled. Do not use a changing offset as an assumed guarantee that every record is processed once.

Verify coverage and relevant consistency after the operation. For example, a planned non-null constraint needs evidence about the remaining nulls, not just evidence that a backfill command exited successfully.

Distinguish a transformation script prepared in the repository from a transformation actually executed. Identify recovery requirements before an irreversible data change in an authorized environment.

## Concurrency and transactions

Name the competing operations and forbidden outcome. A check for an absent row followed by an insert can race; use an appropriate enforced invariant and handle its failure according to the caller's contract.

Confirm that dependent operations share the intended transaction and connection context. Verify the actual isolation and conflict behavior rather than assuming a transaction prevents every race.

If deadlock or conflict retries are relevant, define bounded retry behavior and whether the whole operation can be safely repeated. External side effects are not automatically rolled back with database writes.

## Query semantics and index decisions

Establish the required result before optimizing. Check duplicate rows introduced by joins, null handling, aggregates, deterministic ordering, pagination, and tenant filters when they influence correctness.

Use the actual query shape and representative data to assess plans. An unused index in a tiny fixture does not establish production irrelevance, and a faster local query does not establish a general throughput improvement.

Consider composite-key order, selectivity, and supported index types only where the workload makes them relevant. Account for write and storage cost and check for overlapping indexes before adding another.

Execution-based explain or profiling commands can execute queries, including mutations or side-effecting functions. Prefer an appropriate non-executing diagnostic when sufficient; use execution-based checks only within an authorized scope.

## PostgreSQL, MySQL, and Supabase contexts

Use the project's actual engine and version; these names do not imply identical constraints, DDL, isolation, or indexing behavior. Inspect the migration and query tooling before using engine-specific syntax or options.

In a Supabase or PostgreSQL project using row-level security, inspect the relevant grants, policies, identity context, views, and functions that affect access. Verify read and write restrictions as applicable using the intended roles and tenant cases.

A privileged or owner-like connection may not exercise the ordinary caller's access restrictions. Distinguish a policy definition inspected in source from a policy applied and verified under a representative role.

Do not change policy scope, function execution context, or credential usage merely to make a failing access check pass. Establish the intended access contract and correct the responsible boundary.

## Verification and recovery evidence

Use isolated fixtures for relevant valid and invalid data. Check the real engine for constraints, transactions, and policies; a mocked repository or schema-text assertion cannot establish their runtime behavior.

For migrations, distinguish fresh application, upgrade from an existing state, and any recovery exercise actually performed. Record prerequisites and unavailable checks explicitly.

A backup or rollback command written in a plan does not establish that data can be restored. Describe the known recovery path and its limits; do not test restoration destructively against a live environment without authorization for that action.
