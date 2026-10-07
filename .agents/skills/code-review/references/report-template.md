# Code Review Report

Follow a user-specified or review-interface format when one is required. Otherwise adapt this guide, leading with actionable findings and omitting irrelevant sections.

## Findings

Order findings by practical importance. For each, provide:

- Specific title and priority using the project's scheme when available.
- Inspected file and verified location responsible for the issue.
- Concrete trigger, incorrect behavior, and observable consequence.
- Supporting evidence and any material prerequisites or uncertainty.
- Smallest reasonable correction or a targeted regression check.

Distinguish introduced or newly reachable issues from relevant preexisting context. Avoid duplicate findings, speculative scenarios, and unrequested style suggestions.

If no findings are supported, state that no actionable issues were identified within the reviewed scope. If a missing fact prevents a conclusion, identify that open question rather than implying a clean verdict.

## Scope and open questions

State the comparison, commit, local-change selection, or component reviewed. Identify material missing contracts, inaccessible consumers, or assumptions that limit the assessment.

## Validation

Report checks actually executed and their results. Distinguish source inspection, test reproduction, setup failures, unrelated baseline failures, and checks not run. Do not imply that a proposed test or correction was implemented.

## Next action

Include a concrete next step only when findings or missing evidence require further work. Do not turn a review-only request into unrequested code changes or external approval actions.
