---
name: refactoring
description: Improve internal code structure while preserving intended observable behavior and existing contracts. Use for scoped simplification, extraction, responsibility separation, or removal of demonstrated duplication. Use debugging for an unexplained defect and feature-design for intentional behavior changes rather than treating them as cleanup.
---

# Refactoring

Make the requested code easier to change or understand without silently changing its behavior. Choose a concrete structural improvement, protect the relevant contracts, and proceed in small verifiable steps.

## Establish scope and preservation criteria

- Read applicable `AGENTS.md`, the task, relevant decisions, implementation, callers, and tests. Inspect the working tree so existing user changes are preserved.
- Identify the specific structural problem and the intended improvement, such as duplicated policy, tangled responsibilities, or repeated translation between boundaries. A large file alone does not establish what should change.
- Identify observable behavior that must remain compatible, including outputs, errors, state changes, access restrictions, ordering, and public interfaces where relevant.
- Separate verified behavior, intended contracts, assumptions, and known defects. Existing behavior is evidence, not automatic authority for a business rule.
- Keep the requested area explicit. Do not expand a small extraction into a new architecture, dependency upgrade, schema migration, or broad formatting pass.

If the request is only for a proposal or review, describe the refactor without editing implementation. If implementation is authorized, proceed within that scope without introducing an extra approval gate.

## Establish useful baseline evidence

Inspect the relevant test setup and run focused baseline checks when available and informative. Record known failures and unavailable checks instead of assuming the starting state is healthy.

Where coverage is missing, add focused behavioral or characterization tests if the project has an appropriate setup. Capture meaningful behavior through representative examples; do not encode every incidental internal detail as a permanent contract.

Do not introduce a testing framework as incidental cleanup. If no suitable tests exist, use available reproducible checks and keep the refactor proportionate to the evidence. Report important coverage gaps.

Do not silently preserve a demonstrated vulnerability as intended behavior or fix an unrelated bug under the label of refactoring. Identify the issue and distinguish any already-authorized correction from the structural change. Continue independent work when a material behavior decision remains unresolved.

## Choose the smallest coherent transformation

State how the proposed transformation addresses the observed structural problem. Reuse the existing architecture and language conventions unless the requested improvement calls for changing them.

Inspect all affected callers before renaming or moving shared code. Preserve public contracts unless their change is explicitly within scope; an internal rename must not accidentally alter serialization, routing, configuration, or external consumers.

Consolidate duplicated code only when it represents the same rule or responsibility. Similar syntax with different domain meaning may need to remain separate. Avoid speculative abstractions or interfaces without a demonstrated consumer or boundary need.

Read [methodology.md](references/methodology.md) for characterization, extraction, shared-code changes, or behavior-sensitive transformations when those concerns affect the task. Consult only the relevant sections.

## Transform incrementally and verify

Make a small coherent change, run the narrowest relevant checks, and inspect the diff before building further changes on it. Keep intermediate states usable when practical; tightly coupled edits may need to be verified together.

Preserve relevant evaluation order, asynchronous completion, resource lifetime, error propagation, transaction scope, and component identity. Moving code across a boundary can change these even when the returned value looks the same.

Adjust tests that depend on intentionally changed internals only when the behavioral assertions remain valid and covered. Do not weaken assertions, delete meaningful tests, or update snapshots blindly to hide a regression.

If a transformation causes an unexpected change, isolate and correct the responsible step before continuing. Undo only the agent's own affected edits when needed; do not reset the working tree or overwrite unrelated user work.

## Confirm the improvement and deliver

Expand validation to affected callers, related suites, static checks, or build checks when the changed surface warrants it. Use discovered project commands and verify that targeted tests actually executed.

Review the final diff for scope, accidental behavior changes, public contract drift, and unneeded dependencies. Confirm the structural objective was achieved; fewer lines or more files do not by themselves establish improvement.

Update documentation or imports that actually changed. Use [report-template.md](references/report-template.md) to report the improvement, preservation evidence, executed checks, and limitations, omitting irrelevant sections.

Stop when the requested structural problem is addressed and relevant preservation checks are satisfied. Distinguish unavailable evidence from verified equivalence. Do not keep cleaning unrelated code or infer permission to commit, publish, deploy, or change live data.
