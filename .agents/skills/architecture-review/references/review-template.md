# Architecture Review

Adapt the report to the decision and review scope. Omit empty sections and avoid producing findings merely to populate this template.

## Findings and recommendation

Lead with actionable findings in descending importance. If none were found, state that no material issues were identified within the inspected scope. If evidence is insufficient, name the unresolved decision instead of presenting a clean verdict.

For each finding, provide the following in a concise paragraph or list:

- Finding and priority: the structural issue and why it matters now.
- Evidence: observed behavior or design, inspected paths, and verified lines where available.
- Trigger and impact: the realistic condition and resulting consequence.
- Recommendation: the smallest reasonable correction and its tradeoffs.
- Validation and uncertainty: the check that would establish improvement and any missing evidence.

Separate confirmed problems from conditional risks and optional improvements. Proposed-design findings should cite the supplied design rather than invented implementation locations.

## Scope and constraints

State what was reviewed, the decision or change being evaluated, relevant requirements, and exclusions. Distinguish existing implementation from proposed architecture.

## Relevant architecture

Summarize only the responsibilities, dependencies, state ownership, or contracts needed to understand the recommendation. Add a compact diagram if useful; label proposed or inferred relationships.

## Alternatives and tradeoffs

When a decision has meaningful alternatives, compare the current approach, a minimal correction, and other credible options. Explain the recommendation in terms of requirements, complexity, compatibility, and operation where relevant.

## Transition and verification

Describe compatibility, migration, or recovery prerequisites when the recommendation needs them. Distinguish checks actually performed, their results, and checks still proposed. Omit transition details for a review that recommends no structural change.

## Limitations and next action

State material unknowns and how they affect confidence. Identify the next executable action if further work is necessary, or say that no structural change is recommended within the reviewed scope.
