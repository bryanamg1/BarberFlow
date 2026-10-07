# Testing Report

Adapt this guide to strategy design, test implementation, or execution. Omit irrelevant sections and keep a small report short. Do not label planned work as executed.

## Scope and behaviors covered

Identify the acceptance criteria, invariants, or regressions in scope. State the chosen test levels and why they establish the relevant behavior. For a strategy-only task, describe proposed coverage and mark execution as not performed.

## Intentional changes

List tests, fixtures, helpers, or configuration intentionally changed and their purpose. Explain relevant mocks and the boundaries they leave unverified. Omit this section if no files changed.

## Execution and results

Report commands actually run, the intended selection, observed execution, and results. Include counts only when reported by the runner. Distinguish passed, failed, skipped, timed out, cancelled, and not run when relevant.

Keep assertion failures separate from setup or environment failures. Identify known baseline failures without assuming a cause that was not established. Report both initial failures and retries when investigating intermittency.

## Regression evidence

When protecting a known defect, state whether failure before the fix and success afterward were actually demonstrated. Name any unavailable prior state or missing reproduction evidence. Omit this section when no known regression is being tested.

## Coverage and limitations

State important untested behavior, mocked interactions, unavailable services, or data limitations and their practical impact. Report coverage metrics only if measured. A passing filtered suite does not establish full-suite or live-system verification.

## Next action

Identify the next concrete step if requested coverage or validation remains incomplete. Otherwise state that no additional testing work is required within the verified scope.
