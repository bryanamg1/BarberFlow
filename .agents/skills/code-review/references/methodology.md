# Code Review Methodology

Use the sections relevant to the change. The goal is to detect concrete defects with enough evidence for a useful correction, not to critique every line.

## Identify the comparison and intent

Establish what the user asked to review and which state it is compared against. A branch comparison, one commit, staged work, and all local edits can represent different changes.

Inspect the actual comparison and current file state before citing a line. Identify generated artifacts or dependency changes that influence behavior, but do not treat every generated file as independently authored logic.

Use the ticket, specification, and relevant contracts to understand intentional behavior changes. If requirements are unavailable, distinguish a violation of an inspected existing guarantee from a preference about how the product should behave.

## Follow changed behavior across boundaries

Start from the affected entry point and trace inputs, validation, state changes, calls, errors, and output. Inspect the consumers that can demonstrate a compatibility issue.

For an API response change, determine which inspected callers depend on the old shape. For a database update, determine what happens to dependent writes and existing data. For a frontend effect, determine which input changes or response order can make displayed state incorrect.

Avoid assuming a call exists because a function is exported or a bug is reachable because a branch appears suspicious. Trace the real path or state the missing evidence.

## Build a candidate finding as a causal chain

A useful finding explains:

- A supported starting condition or input.
- The changed operation that behaves incorrectly.
- Why existing guards do not prevent it.
- The resulting failure or contract violation.

For example, if an inspected client still reads a renamed response field, establish the endpoint's new output, the remaining caller, and the failed behavior. Do not claim all clients break when only one caller was inspected.

Discard a candidate when a surrounding guarantee makes its trigger impossible within the contract. Do not require defensive code for impossible states without evidence that the boundary can actually admit them.

## Attribute regressions accurately

Compare the relevant prior behavior when available. Determine whether the change introduced the defect, widened its reach, or only exposed an unrelated existing problem in the same area.

For a change-focused review, prioritize introduced or newly reachable issues. Label a preexisting issue separately if it affects the requested decision; avoid implying that the author created it.

If the baseline cannot be inspected, describe the current defect and the attribution limit. Do not assert that a test passed before the change unless that result or equivalent evidence is available.

## Evaluate tests without substituting them for reasoning

Inspect whether tests exercise the relevant trigger and assert the meaningful result. A status assertion alone may miss a forbidden data change; a mock may hide the persistence or integration behavior that matters.

A missing test is most useful as a finding when it leaves a concrete required behavior or demonstrated failure unprotected, or violates an explicit project requirement. Do not inflate every untested branch into a functional defect.

When running checks, use the narrowest informative selection and confirm it executed. Keep failures of setup, tooling, or unrelated baseline tests separate from failures attributable to the reviewed change.

If a new reproduction is useful and within scope, keep it isolated and report its actual outcome. A proposed regression test is a recommendation, not execution evidence.

## Calibrate priority and confidence

Use project or review-interface priorities when defined. Otherwise prioritize by the consequence, likelihood under realistic inputs, and scope of affected behavior.

Distinguish an urgent widespread failure from a defect requiring a specific valid edge case. Both can be actionable, but their priority should reflect the evidence. A severe hypothetical impact does not compensate for an unsupported trigger.

Confidence describes how well the evidence establishes the issue, not how severe its impact would be. When one unknown decides whether behavior is incorrect, investigate or ask a focused question instead of presenting the unknown as fact.

Separate optional improvements from defects. Do not prescribe an architectural pattern, additional dependency, or broad refactor unless it is needed to address an established issue within scope.

## Write concise findings at the responsible location

Use a specific title and a short explanation connecting trigger, consequence, and correction. Include prerequisites that constrain the claim and enough context for the author to evaluate it without repeating the entire investigation.

Use verified file and line references. Keep an inline range narrow enough to identify the responsible operation. If evidence lies outside the diff, cite that supporting context explicitly rather than moving the finding onto an arbitrary changed line.

Group duplicate manifestations when one root cause and correction address them. Keep distinct causes separate even when their symptoms look similar.

## Close the review with honest limits

State the inspected comparison or component and any material unavailable context, such as an external contract, production configuration, or required test environment.

If no actionable findings remain, say so within that scope. Do not present absent evidence as a clean bill of health or require unnecessary redesign to make the review appear thorough.
