---
name: architecture-review
description: Review existing or proposed software architecture for responsibility boundaries, dependency direction, coupling, data ownership, and contract tradeoffs. Use for structural design decisions or changes spanning components. Use code-review for localized implementation defects and planning for execution sequencing.
---

# Architecture Review

Assess whether the structure supports the requested behavior and the project's actual constraints. Produce evidence-backed findings and proportionate recommendations. Keeping the current architecture is a valid conclusion.

## Define the review boundary

- Identify the decision, change, or system area under review and the relevant acceptance criteria.
- Read applicable `AGENTS.md`, supplied designs, relevant architecture decisions, implementation, and tests. Inspect deployment or operational configuration only where it influences the decision.
- Distinguish review of an existing system, a proposed design, and a specific change. For a change, compare the affected contracts and dependencies with the prior behavior when available.
- Separate documented intent from observed structure and identify conflicts. Existing conventions are constraints to understand, not automatic evidence that the design is correct.
- Record inspected areas, exclusions, and unavailable evidence. If only a design is available, assess it as a proposal rather than implying implementation has been verified.

Keep a review-only task observational, apart from explicitly requested review artifacts. Do not refactor, generate an architecture document in the repository, or change configuration merely to demonstrate a recommendation.

## Trace responsibilities and dependencies

Trace a representative flow through the affected components and identify which component owns each important decision and piece of state.

Distinguish source imports, runtime calls, data dependencies, and deployment dependencies. Check the boundaries relevant to the task, such as domain rules, UI state, request handling, persistence, background work, and external integrations.

Look for structural issues with a demonstrable consequence: duplicated policy that can diverge, hidden coupling, incompatible contracts, circular initialization, ambiguous data ownership, or failure propagation across a boundary. A large file, shared helper, or unfamiliar folder layout is not sufficient evidence by itself.

Read [methodology.md](references/methodology.md) when the review spans multiple boundaries, shared state, asynchronous work, or competing structural options. Consult the relevant sections rather than treating every dimension as a required audit.

## Evaluate against actual requirements

Use the project's behavior, team workflow, compatibility needs, and operational constraints to judge tradeoffs. Do not invent traffic forecasts, service-level targets, or future consumers to justify complexity.

For a proposed feature, check whether its rules and invariants have a clear owner and whether the proposed contracts preserve them. If a missing business decision changes the architecture, name that dependency instead of silently defining the rule.

For claims about performance, resilience, or security, distinguish structural reasoning from measured behavior or a verified defect. Request or collect the relevant evidence when the recommendation depends on it; otherwise label the uncertainty and avoid unsupported conclusions.

Do not mandate a particular layering scheme, framework, service split, event bus, or design pattern. Evaluate a convention by the problem it solves here and the costs it introduces.

## Build actionable findings

For each material finding, explain:

- The observed or proposed structure and its evidence, with inspected paths and verified line numbers where available.
- The concrete trigger or change scenario that exposes the issue.
- The resulting impact on correctness, change propagation, testability, compatibility, or operation.
- The smallest reasonable correction, important tradeoffs, and how to validate it.
- Remaining uncertainty and what evidence would confirm or reject the concern.

Prioritize findings by impact and likelihood within the stated scope. Keep a demonstrated problem separate from a conditional risk or optional improvement. Do not inflate a preference into a blocker or invent findings to fill a report.

## Compare options proportionally

When a structural decision has meaningful alternatives, compare the current approach, a minimal correction, and other credible options as needed. Consider compatibility, complexity, testing, operation, and migration cost where relevant. Explain why the recommendation fits the evidence.

Recommend an incremental transition when existing consumers or data make it necessary. Identify any compatibility or recovery prerequisite. Leave detailed implementation sequencing to `planning` when useful; no other skill is required to use this review.

## Deliver and stop

Use [review-template.md](references/review-template.md) as an adaptable report guide. Lead with the most consequential findings, or state that no material issues were found within the inspected scope. Distinguish insufficient evidence from a clean review.

Report only inspections and checks actually performed. A structural review does not establish that the system is secure, performant, or regression-free. Describe targeted checks still needed to verify recommendations.

Stop when the requested decision is supported and the relevant findings are actionable. Do not expand into an unrelated redesign. If implementation is also authorized, continue with the sufficiently understood work within that scope; do not impose a blanket approval gate or infer permission for deployment or live-data changes.
