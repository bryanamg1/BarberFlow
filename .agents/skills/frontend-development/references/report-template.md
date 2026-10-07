# Frontend Delivery Report

Adapt this guide to the change. Omit irrelevant sections and keep a small delivery report short. Describe actual outcomes rather than repeating implementation guidance.

## Delivered experience

State the user-visible behavior implemented and the acceptance criteria it satisfies. Identify any blocked or partially implemented flow explicitly.

## Intentional changes

Summarize affected routes, components, shared controls, styles, or data flows and the purpose of changed files. Mention relevant design-system or contract changes and their callers.

## Interaction and state

Describe relevant loading, empty, error, success, and recovery behavior. Mention state ownership, form handling, mutation reconciliation, or permission feedback only when they influence the change.

## Validation

Report checks actually executed and their results. Distinguish automated tests, build or static checks, mocked integration, and actual browser or server verification.

For browser inspection, identify the relevant viewport conditions and interactions exercised, including keyboard or focus checks when performed. Do not label accessibility, integration, or responsive behavior verified solely because the build or a screenshot succeeded.

Mark unavailable or proposed checks as not run and state their practical coverage limitation.

## Configuration and documentation

Mention actual new dependencies, configuration, component usage guidance, or changed integration requirements. Do not include sensitive values. Omit this section when nothing changed.

## Remaining risks and next action

Identify unverified browser behavior, unavailable backend dependencies, unresolved decisions, or other material limitations. Name a concrete next action when needed; otherwise state that no additional work is required within the implemented scope.
