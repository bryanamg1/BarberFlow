---
name: feature-design
description: Turn a software feature idea or incomplete ticket into a behavioral specification with scope, business rules, user flows, relevant states, and testable acceptance criteria. Use when intended behavior needs definition before implementation. Use planning for implementation sequencing and architecture-review for structural tradeoffs once behavior is clear.
---

# Feature Design

Define what a feature must do and how to establish that it works. Produce enough detail for implementation without inventing business policy or expanding the requested product.

## Understand the need and current behavior

- Identify the user or actor, the problem, the desired outcome, and the constraints supplied by the user.
- Read the supplied ticket, relevant product documentation, and applicable `AGENTS.md`. Inspect the affected implementation and tests when a project is available.
- Distinguish existing behavior, explicit requirements, proposed changes, assumptions, and unresolved decisions. Existing code is evidence of current behavior, not proof of the intended business rule.
- Flag contradictions between sources and explain which behavior they affect. Do not silently choose a policy that changes the user's requirements.
- If project access is unavailable, state that the design is provisional and identify the integration points that still need inspection.

If behavior and acceptance criteria are already complete, check only relevant gaps and move to the requested next activity. Do not create a lengthy specification for a straightforward edit.

## Bound the feature

State the smallest coherent scope that achieves the requested outcome, along with explicit exclusions. Preserve requested capabilities; do not drop them under an assumed minimum viable product.

Separate required behavior from optional suggestions. Keep optional improvements outside the committed scope unless the user has already authorized them.

Ask only about missing decisions that materially affect business correctness, access, data loss, external effects, or scope and cannot be resolved from available context. State reversible assumptions and continue independent design work. Do not treat unanswered questions as approval.

## Specify observable behavior

Define the relevant actors, preconditions, action, result, and failure behavior for each use case. Cover the normal flow and the alternatives that change correctness or the user outcome.

For each business rule, state the condition and required result or invariant. Identify who may perform an action, on which records, and under which conditions when access matters. Distinguish a role from ownership or tenant scope.

Describe persisted effects separately from feedback shown to the user. For stateful features, define meaningful states and allowed transitions, including what happens when an action is invalid in the current state.

Read [methodology.md](references/methodology.md) when the feature includes lifecycle transitions, overlapping actions, external effects, or ambiguous business rules. Consult only the sections relevant to the task.

## Make the specification testable

Write acceptance criteria with a concrete starting condition, action, and observable result. Use Given/When/Then or another concise format that expresses the same information.

Connect important rules and transitions to acceptance criteria. Include applicable negative cases, such as invalid input, insufficient access, or a failed external operation. Choose cases based on the feature rather than requiring every possible edge case.

Replace vague requirements such as "fast" or "user-friendly" with observable expectations when evidence or user requirements support them. Do not invent performance targets, retention periods, financial rules, or service guarantees. Mark material missing targets as decisions to resolve.

Acceptance criteria specify checks to perform later; do not claim that tests passed or the behavior exists unless it was actually verified.

## Deliver a design that can guide implementation

Use [feature-template.md](references/feature-template.md) as an adaptable guide. Present the design in the conversation unless the user requests a file or the project defines a specification location. Omit irrelevant sections.

Identify affected components or contracts from inspected evidence. Label proposed interfaces and new files as proposals. Leave implementation sequencing to `planning` when available and useful; the design must remain usable without that skill.

Stop elaborating once scope, relevant behavior, and acceptance criteria are coherent and material decisions are resolved or explicitly attached to affected work. If a decision still blocks correctness, describe which part is not ready rather than declaring the entire design complete.

When the request covers design only, do not modify implementation code. When implementation is also authorized, continue with the sufficiently specified work within that authorization. Do not introduce a blanket approval gate or infer permission to publish, deploy, or change live data.
