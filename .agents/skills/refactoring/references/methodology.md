# Refactoring Methodology

Consult the sections relevant to the transformation. Prefer explicit preservation criteria and small feedback loops over a generic rewrite.

## Define the structural improvement

Connect the refactor to a concrete change cost or comprehension problem. For example, a domain rule duplicated across two entry points can drift, while a function mixing input parsing and a calculation may be hard to test independently.

Choose a transformation that addresses that problem, such as extracting the shared rule or separating parsing from calculation. Do not assume that additional layers, a class hierarchy, or a new library improve every project.

Keep optional cleanup separate from the requested objective. If another change is necessary for the refactor, explain that dependency instead of silently broadening scope.

## Establish a behavioral baseline

Identify the relevant inputs, outputs, errors, state changes, and external contracts. Inspect callers and tests to distinguish intended guarantees from implementation details.

Run focused baseline checks when practical. If a test already fails, record its behavior and relevance rather than treating all later failures as regressions or all existing failures as harmless.

Use characterization tests to record poorly documented but relevant behavior before reorganizing it. Assert a concrete outcome independently of the implementation where possible; avoid calculating the expected answer with the same helper under test.

If characterization exposes a likely bug or security defect, separate observed behavior from intended behavior. Do not decide a new business rule merely to complete the refactor, and do not make a dangerous outcome a permanent expected result without examining the contract.

## Extract or consolidate without changing meaning

Before extracting a function, identify its inputs, outputs, mutations, required context, and error behavior. A closure may depend on identity, mutable state, or execution timing that a new parameter list must preserve.

When consolidating duplication, establish that the callers share the same semantics. Similar validation in two domains can represent different policies; a generic function with many caller-specific switches may hide that distinction rather than improve it.

Preserve relevant defaults and the differences between omitted, empty, null, and invalid input. Keep exception handling and normalization at their responsible boundaries rather than silently moving behavior to a different caller.

## Move and rename shared code carefully

Locate actual imports, exports, configuration references, dependency injection bindings, generated mappings, and other consumers relevant to the language and project. A text search alone may miss dynamic lookup or serialized names.

Distinguish internal names from public API fields, URLs, stored values, event names, or reflection-based identifiers. Preserve external contracts unless the requested change explicitly includes their evolution.

Keep imports and module initialization behavior coherent. If a move introduces a dependency cycle or changes initialization order, establish its effect rather than assuming the build proves runtime equivalence.

Avoid unnecessary compatibility wrappers for private code when all consumers can be updated together. Preserve a boundary when an existing consumer cannot change within scope.

## Preserve effects, lifetime, and ordering

For asynchronous work, preserve which operations are awaited, their order, and how failures reach the caller. Replacing sequential operations with parallel execution is a behavior change when they share state or their effects depend on order.

For persistence, preserve transaction and connection context. Extracting a write into a helper must not silently move it outside the transaction that protects an invariant.

For resources, preserve creation, reuse, and cleanup semantics. Moving construction into a shared scope can introduce shared state, while moving it into a loop can change cost and lifetime.

For UI components, preserve relevant state ownership, identity, focus behavior, and effects. A visually identical render does not establish that an extraction preserves local state or keyboard interaction.

If performance is an explicit constraint, use relevant measurements. Do not claim a refactor improves latency or memory solely because the code is shorter or appears cleaner.

## Keep verification meaningful during change

After each coherent step, run the smallest check that can expose its likely regression. Use broader checks when shared callers or integration boundaries change, rather than repeating the entire suite after every trivial edit.

An internal test may need adaptation after an authorized extraction or rename. Preserve its behavioral purpose and review assertion changes for weakened guarantees. Do not replace a meaningful interaction test with mocks that bypass the affected boundary.

If a step fails, identify whether the failure is a baseline issue, environment issue, or introduced behavior change before proceeding. Keep incomplete transformations visible and avoid stacking more changes on an unexplained failure.

Use isolated comparisons when additional evidence is useful. Never discard user changes to obtain a clean baseline or to undo the agent's own unsuccessful transformation.

## Judge completion against the objective

Confirm the requested responsibility is clearer, the demonstrated duplication is removed, or the targeted complexity is reduced while relevant behavior remains supported by checks.

State evidence and limits precisely. Passing unit tests do not establish every external consumer or deployment property. If important checks are unavailable, describe what remains unverified instead of claiming complete behavioral equivalence.
