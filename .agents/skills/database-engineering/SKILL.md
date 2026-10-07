---
name: database-engineering
description: Design, implement, or review database schemas, constraints, queries, indexes, migrations, and data transformations. Use when database integrity, access policies, concurrency, or measured query performance is the primary concern. Use backend-development for surrounding API behavior and debugging when the failure mechanism is still unknown.
---

# Database Engineering

Deliver the requested database behavior while preserving data meaning, integrity, access boundaries, and compatibility. Adapt to the actual engine, version, migration tooling, and project conventions.

## Establish the database context

- Read applicable `AGENTS.md`, the supplied task, relevant decisions, schema definitions, migrations, query callers, and tests. Inspect the working tree before editing a repository.
- Identify the engine, version when relevant, ORM or query layer, migration runner, and target environment from evidence. Do not infer that a named database is disposable or local.
- Distinguish schema design, schema migration, data repair, query optimization, and access-policy work. A task may require more than one, but each has different completion criteria.
- Identify the affected invariant, existing consumers, data semantics, and acceptance criteria. Resolve material business rules rather than inventing deletion, uniqueness, monetary, or retention policies.
- Separate repository definitions, recorded migration state, and inspected database state. If a database is unavailable, label conclusions based only on source inspection accordingly.

A review-only request permits observation and requested review artifacts, not schema or data changes. Authorized implementation permits appropriate repository edits and authorized test-environment checks; it does not itself authorize changes to a live database.

## Model meaning and enforce integrity

Define entity identity, relationships, required values, valid states, and relevant uniqueness or ownership boundaries before selecting constraints. Reuse existing naming and type conventions when they preserve the required meaning.

Use database constraints where supported and appropriate to enforce invariants across writers. Application validation alone cannot establish integrity under concurrent writes. Check the engine's actual null, uniqueness, collation, and foreign-key behavior when the invariant depends on it.

Choose types according to the domain's precision, range, timezone, and comparison semantics. Define delete behavior from the business requirement; do not introduce cascading deletion or soft deletion by default.

## Design compatible changes

Inspect applied-migration history and existing data before deciding how to evolve the schema. Follow the project's migration conventions. Do not assume editing an already-applied migration will change an existing database.

Account for current readers and writers, defaults, nullability, generated code, views, triggers, and access policies where affected. Use a compatibility transition only when existing data or overlapping application versions require it.

For a backfill or repair, define the target set, transformation, postcondition, and handling of concurrent writes or partial progress. Do not invent missing data or silently discard invalid records to make a new constraint pass.

Read [methodology.md](references/methodology.md) for migrations, backfills, concurrency, query performance, or database access policies when those concerns are part of the task. Consult the relevant sections rather than running a universal checklist.

## Verify transactions and access boundaries

Identify which writes must succeed together and the concurrent operations that can violate the invariant. Use supported constraints, conditional writes, transactions, or locking as warranted by the actual engine and isolation behavior.

Use parameterized values through the established query layer. Handle dynamic identifiers or sort options with supported composition or a defined allowlist rather than interpolating untrusted input.

Preserve relevant database roles, grants, tenant boundaries, and row-level policies. Validate policies using representative effective roles; a privileged connection alone cannot establish restrictions for ordinary callers. Do not broaden access or expose credentials merely to simplify a query or test.

## Optimize from evidence

Preserve query results and ordering while investigating performance. Inspect actual predicates, joins, cardinality, pagination, and existing indexes. Use representative plans or measurements when available; label unmeasured improvements as proposals.

Assess the read benefit and write, storage, and migration cost of an index. Do not add an index to every column or foreign key without considering the actual engine and workload.

Check what a diagnostic command executes and what effects it can have before running it. Execution-based plan collection may run the statement; it must fit the authorized environment and operation.

## Validate and report

Use an authorized isolated environment when available to apply migrations and exercise actual database behavior. Test upgrade from a representative prior state when changing an existing schema; fresh-database success alone does not establish upgrade compatibility.

Cover relevant accepted and rejected data, relationship integrity, concurrent operations, query semantics, or role-based access. Use the project's test setup; do not mock away a constraint or transaction whose behavior the check must establish.

Verify postconditions after a transformation, such as preserved totals, resolved nulls, or absence of duplicates, according to the actual invariant. Report prerequisite data conflicts as unresolved rather than claiming successful completion.

Describe locking, deployment order, recovery, or rollback only where relevant. Distinguish reverting schema from restoring transformed or deleted data; do not promise recovery without evidence of a usable recovery path.

Review the final diff for unintended schema, policy, generated-file, or data changes. Update affected schema and operating documentation when needed. Use [report-template.md](references/report-template.md) for actual changes, executed checks, and limitations, omitting irrelevant sections.

Stop when the requested invariant or improvement is supported by relevant validation. Continue independent authorized work when an environment or decision blocks one portion. Do not infer permission to run live migrations, reset databases, publish, deploy, or commit.
