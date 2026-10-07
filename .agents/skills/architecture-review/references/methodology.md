# Architecture Review Methodology

Use the dimensions relevant to the requested decision. Avoid turning a focused review into an exhaustive system audit.

## Reconstruct the affected architecture

Start from a representative entry point and follow the behavior across boundaries. Record each component's responsibility, dependencies, owned state, and externally visible contract when they influence the review.

Prefer inspected call paths, schemas, tests, configuration, and deployment definitions over assumptions based on directory names. An import proves a source dependency; it does not by itself prove runtime execution or a production bottleneck.

Use a small flow or dependency diagram only when it clarifies a finding. Label inferred relationships and proposed components so they cannot be mistaken for verified implementation.

## Evaluate ownership and cohesion

Identify where each important rule is defined and enforced. Check whether multiple entry points apply the same rule consistently and whether a component combines responsibilities that change for unrelated reasons.

Example: two booking entry points independently implement cancellation eligibility. If the inspected rules differ, describe the affected callers and resulting inconsistency. A shared domain operation may be a useful correction, but a service split is not implied by that finding.

Keep similar-looking logic separate when it represents different rules. Recommend consolidation only after establishing shared meaning and ownership, not merely matching syntax.

## Examine coupling through realistic changes

Ask what must change when a relevant requirement changes. Trace callers, shared types, database consumers, configuration, and external contracts rather than judging coupling only by import count.

Examples of useful questions include whether a UI change forces unrelated persistence changes, whether a domain operation depends on a framework request object, and whether a shared schema ties independently deployed consumers together.

Explain the concrete cost or failure scenario. Depending on the project, direct module calls or a shared database may be an intentional, economical design. Record the tradeoff rather than treating distribution as an automatic improvement.

For a dependency cycle, establish its consequence, such as initialization order, inability to isolate a component, or repeated coordinated changes. A graph cycle alone does not establish severity.

## Inspect data ownership and consistency

Identify authoritative state, writers, derived values, and caches for the affected invariant. Check transaction boundaries and whether important state changes can partially succeed.

For an operation that updates local data and invokes an external service, determine what each failure point leaves behind. Consider whether existing reconciliation or recovery behavior addresses that state before recommending a new mechanism.

Do not assume that a local database transaction makes an external side effect atomic. If reliable delivery or duplicate prevention matters, identify the required guarantee and the evidence about current behavior before choosing an outbox, queue, retry, or compensation strategy.

## Consider deployment and operation when relevant

Establish which components actually deploy, scale, and fail independently. Inspect versions or consumer overlap when a contract changes. Separate a source-level module boundary from a deployed service boundary.

A recommendation for a new service should explain the concrete benefit and account for communication, failures, observability, ownership, and operational cost. Do not recommend additional infrastructure on an unsupported assumption about future scale.

If latency or capacity is decisive, use available measurements or identify the experiment needed. Label predictions as predictions; structural reasoning alone does not establish throughput.

## Compare alternatives and transition costs

Include the current approach as a credible option when it satisfies the requirements. Compare only alternatives that could reasonably address the observed problem.

For each relevant option, explain the benefit, introduced complexity, contract impact, and validation or transition needs. Avoid numeric scores without defined criteria and evidence.

For a breaking change, identify affected consumers and whether compatibility can be maintained during transition. If a rollback cannot restore changed or deleted data, describe the recovery gap instead of promising reversibility.

## Calibrate evidence and priority

An actionable finding connects an observed structure to a realistic trigger and consequence. If a dependency or trigger is unverified, present the concern as conditional and identify the evidence needed.

Reserve the highest priority for issues that materially threaten required behavior or a necessary transition. Maintainability concerns can matter, but their priority should reflect a demonstrated change cost rather than stylistic preference.

A valid review may conclude that the current boundaries fit the task. State what was inspected and what remains unknown; do not equate an absence of findings with proof about the entire system.
