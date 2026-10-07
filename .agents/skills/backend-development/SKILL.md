---
name: backend-development
description: Implement or extend server-side features, API endpoints, services, background jobs, and integrations in an existing project's stack. Use for backend delivery involving contracts, validation, authorization, persistence, or external effects. Use debugging first when an unexplained failure still needs diagnosis; a review-only request does not authorize implementation.
---

# Backend Development

Deliver the requested server-side behavior with compatible contracts, enforced business rules, and evidence from relevant validation. Adapt to the project's language, framework, and architecture rather than introducing a preferred stack.

## Establish the behavior and affected path

- Read applicable `AGENTS.md`, the supplied ticket or specification, and relevant decisions. Inspect the working tree before modifying an existing repository.
- Trace the affected route, handler, service, job, persistence operation, or integration and inspect its callers and tests. Use existing patterns where they support the requirement.
- Identify acceptance criteria, inputs, outputs, access scope, state changes, failure behavior, and compatibility constraints.
- Separate verified behavior from assumptions. Resolve business decisions that materially affect correctness; do not invent eligibility, ownership, financial, or lifecycle rules.
- Keep a small change direct. Use a short implementation plan when dependencies or uncertainty warrant it, without requiring another skill or an extra approval step.

For a greenfield task, use the requested stack. If none is specified, choose a minimal approach consistent with available constraints and state material assumptions rather than silently creating a larger platform.

## Define and preserve the contract

Follow the project's established transport and error conventions. For HTTP, identify the method, path, accepted input, response shape, relevant status outcomes, and affected clients. For jobs or events, identify payload, delivery, and completion semantics where relevant.

Validate external input at the boundary, including supported types and relevant limits. Distinguish omitted, null, empty, and invalid values where the contract treats them differently. Restrict writable and returned fields to the intended contract rather than passing an entire client object into persistence or returning an internal record unchanged.

Preserve existing contracts unless the requested change requires otherwise. Account for current consumers when changing schemas, responses, or event payloads. Do not invent new versioning or infrastructure for a compatible change.

## Enforce rules at the responsible boundary

Authenticate and authorize using established project mechanisms. Apply relevant role, ownership, tenant, and lifecycle restrictions on the server; derive trusted identity from the established authentication context rather than user-controlled ownership fields.

Keep domain decisions in the component that owns them, using the existing architecture. Avoid duplicating rules across routes and workers when they represent the same invariant. Do not introduce controller/service/repository layers merely to satisfy a naming pattern.

Handle asynchronous results and errors through the project's actual framework and runtime conventions. Inspect installed versions before relying on version-specific behavior, especially for middleware ordering, exception propagation, and request cancellation.

## Preserve consistency across effects

Identify which writes must succeed together and what concurrent requests or repeated deliveries can do to the invariant. Use appropriate existing constraints, transactions, or conditional updates; a read followed by a write does not by itself prevent a race.

Distinguish local persistence from external operations. Define what happens when an external action succeeds but its response or the following local write fails. Do not add automatic retries until duplicate effects and ambiguous outcomes have been considered.

Read [methodology.md](references/methodology.md) for the relevant guidance when implementing persistence invariants, external integrations, background work, or Node.js/Express behavior. Skip sections unrelated to the change.

## Handle failure and operation proportionally

Return failures that match the established contract and preserve useful internal error context without exposing secrets or private implementation details. Avoid empty catches, false success responses, arbitrary delays, or broad exception suppression.

Use existing logging and correlation conventions for actionable failures. Do not log credentials, tokens, or sensitive payloads. Add configuration, dependencies, timeouts, or observability only when the requested behavior needs them, and document actual new requirements.

## Validate and deliver

Add or update behavioral tests where the project has an appropriate test setup. Cover the acceptance criteria and relevant failure boundaries, including invalid input, unauthorized access, inconsistent state, or repeated effects when applicable. Do not mock away the interaction whose correctness the test must establish.

Run the narrowest relevant checks first, then related tests, type checks, lint, or build checks as warranted by the change. Use discovered project commands. If no test setup exists, perform a concrete available check and report the coverage limitation rather than adding an unrelated testing framework.

Review the final diff for unintended changes, accidental credentials, and compatibility with affected callers. Update API or configuration documentation when the contract or operating requirements changed.

Use [report-template.md](references/report-template.md) to summarize the delivered behavior, intentional changes, executed validation, and remaining limitations. Omit sections that add no value. Distinguish proposed checks from actual results and partial implementation from verified completion.

Stop when the requested behavior and relevant validation are satisfied. State any blocked portion precisely and continue independent authorized work. Do not turn implementation into an unrelated refactor or infer permission to commit, publish, deploy, or change live data.
