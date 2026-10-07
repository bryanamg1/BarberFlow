---
name: planning
description: Build an actionable implementation plan for multi-step software changes, cross-component features, migrations, and substantial refactors. Use when the user requests a plan or when dependencies and uncertainty require sequencing before implementation. Keep straightforward edits lightweight; diagnosing an unexplained defect belongs to debugging.
---

# Planning

Turn the requested outcome into a grounded sequence of changes with clear scope, dependencies, risks, and validation. Scale the plan to the task rather than imposing a fixed number of steps.

## Establish the task boundary

- Identify the intended outcome, acceptance criteria, constraints, and explicit exclusions.
- Read applicable `AGENTS.md` instructions and the supplied ticket or specification. Inspect the relevant implementation, tests, configuration, and documentation before proposing concrete changes.
- Check the working tree when working in a repository so the plan accounts for existing work without assuming it can be overwritten.
- Reference inspected paths as evidence. Label proposed files as new and unverified locations as candidates; do not invent existing modules, test commands, or project conventions.
- Separate confirmed facts, working assumptions, and unresolved decisions.

If the user requests only a plan, limit changes to explicitly requested planning artifacts. If the user also authorizes implementation, planning is preparation for that work; continue within that authorization once the next steps are clear. Do not introduce a blanket approval gate.

## Resolve uncertainty proportionally

Investigate uncertainties that could change correctness, scope, public contracts, data handling, or the order of work. Ask the user only when a material decision cannot be resolved from available evidence or existing authorization.

For a reversible detail with a reasonable default, state the assumption and proceed. For an unresolved decision that blocks a step, identify the decision and affected step while continuing independent work.

Do not invent business rules to make a plan appear complete. When behavior is underspecified, identify the missing acceptance criterion. If defect diagnosis is the unresolved prerequisite, record an investigation step or use `debugging` when available before committing to a repair design.

## Design the implementation sequence

1. Identify the smallest coherent change that satisfies the acceptance criteria. Preserve existing contracts unless the task calls for changing them.
2. Identify prerequisites and affected boundaries, including callers, persistence, external integrations, and configuration where relevant.
3. Order steps by their dependencies. Each step should name a concrete outcome, likely files or components, prerequisites, and a way to verify completion.
4. Place discovery work before changes that depend on its result. Keep speculative implementation conditional rather than presenting a guess as a decision.
5. Include tests and documentation where they support the requested behavior. Keep unrelated cleanup outside the plan.

Read [methodology.md](references/methodology.md) when sequencing spans multiple components, uncertainty requires a discovery step, or a migration requires compatibility and rollout decisions. Do not load it for a straightforward plan that needs no additional guidance.

## Make completion observable

Map acceptance criteria to appropriate checks. Prefer targeted behavioral checks first and broader validation when the affected surface warrants it. Use project-supported commands discovered during inspection.

State relevant prerequisites for proposed checks, such as fixtures, local services, credentials, or an available test environment. If no automated test exists, propose a concrete manual check rather than inventing a test suite.

Treat planned validation as not run. Distinguish checks actually executed during investigation from checks to execute after implementation. Identify what evidence is still needed before declaring the change complete.

For meaningful risks, name the triggering condition, likely impact, and a concrete mitigation or decision. Include deployment order, rollback, or recovery only when the change actually requires them. A plan does not grant permission to publish, deploy, modify live data, or delegate work.

## Deliver and maintain the plan

Use [plan-template.md](references/plan-template.md) to organize the result, omitting sections that add no value. Present the plan in the conversation unless the user requests a file or the project defines a planning location.

Stop planning once the next steps are executable and material uncertainty is either resolved or attached to an explicit prerequisite. Do not expand into a redesign of unrelated systems.

When continuing with authorized implementation, update the plan if evidence changes the approach. Mark steps complete only when their stated outcomes and checks are satisfied; record blocked or deferred steps explicitly.
