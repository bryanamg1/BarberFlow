# Database Engineering Report

Adapt this guide to the requested design, implementation, or review. Omit irrelevant sections and report actual evidence rather than repeating a generic checklist.

## Outcome and scope

State the requested invariant, query behavior, schema change, or review decision and the portion completed. Identify the actual engine and inspected environment when known, without exposing connection details.

## Evidence and intentional changes

Summarize relevant schema, migration state, query behavior, or existing-data findings. Distinguish source inspection from live metadata or data inspection. List intentional file, schema, query, index, or policy changes and their purpose.

For review-only work, report actionable findings with evidence, impact, and a proportionate recommendation instead of implying changes were applied.

## Integrity, access, and compatibility

Explain relevant constraints, data semantics, transaction boundaries, role or tenant restrictions, and affected consumers. State migration ordering or backfill prerequisites only when they matter to the change.

## Validation and measurements

List checks actually executed and their results. Distinguish fresh schema tests, upgrades, data postcondition checks, concurrency tests, query measurements, and role-based policy tests as applicable.

Identify the data and environment limitations of measurements. Mark proposed checks and unavailable database verification as not run; do not equate schema source checks with an applied migration or verified constraint.

## Application and recovery status

State whether changes were only prepared or actually applied and in which authorized environment. Describe rollback or recovery only where relevant and separate schema reversal from data restoration. Do not include private records or credentials.

## Remaining risks and next action

Identify unresolved data conflicts, unsupported assumptions, unavailable environments, or unverified recovery requirements and their impact. Name a concrete next step if work remains; otherwise state that no additional action is required within the verified scope.
