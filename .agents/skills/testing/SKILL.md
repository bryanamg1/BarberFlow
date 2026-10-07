---
name: testing
description: Design, implement, or execute a focused software test strategy for acceptance criteria, changed behavior, regressions, and meaningful coverage gaps. Use when testing is the main task or a change needs dedicated validation design. Use debugging for unexplained failures before changing expected behavior; trivial edits do not require a new test suite.
---

# Testing

Establish whether the requested behavior is correct through tests that can detect a meaningful failure. Choose the smallest appropriate validation surface and report what the evidence actually supports.

## Establish the contract and existing test setup

- Read applicable `AGENTS.md`, the task, acceptance criteria, relevant implementation, and adjacent tests. Inspect the working tree before editing a repository.
- Discover the test runner, scripts, fixtures, configuration, and environment requirements from the project. Do not invent commands or assume that every test suite uses the same setup.
- Identify the behavior to protect, the relevant failure boundary, and the available evidence for the expected result. Do not derive an expected value solely by copying the implementation under test.
- Distinguish a request to design a strategy, add tests, run tests, or repair failing tests. A strategy-only request does not authorize implementation changes.
- Identify known baseline failures when relevant and feasible. If no baseline was run, state that rather than assuming a failure was introduced by the current change.

Use existing tooling when it fits the task. If no test setup exists, propose or perform a concrete available check. Do not add a testing framework as an incidental dependency; establishing one must fit the requested scope.

## Select meaningful cases and test levels

Map important acceptance criteria or invariants to a trigger and observable result. Include relevant successful, denied, invalid, boundary, or recovery cases, rather than generating every possible input combination.

Prefer a unit test for an isolated rule, an integration test for an interaction whose real behavior matters, and an end-to-end test for a critical flow across application boundaries. Use multiple levels only when they protect distinct behavior.

Choose a test that would fail if the relevant defect or violation occurred. Do not test private implementation details, static wording, or reversible low-impact changes merely to increase the test count.

Read [methodology.md](references/methodology.md) for regression proof, test doubles, fixtures, asynchronous behavior, or flaky failures when those concerns affect the task. Consult only the relevant sections.

## Implement tests that can fail for the right reason

Use explicit setup, an exercised action, and assertions tied to the required outcome. Check relevant side effects or their absence where a status code or visible message alone would miss the defect.

Use mocks or fakes at deliberate boundaries. Do not mock the constraint, serializer, transaction, authorization, or integration behavior that the test is supposed to establish. Clearly distinguish a simulated provider response from verification of the real provider contract.

Keep tests isolated from one another and from unrelated data. Control time, randomness, timers, and external dependencies where they influence the result. Await asynchronous work and use supported observable completion rather than arbitrary delays.

For regression protection, establish that the test detects the original defect when a known failing state is available. Use an isolated reproduction or safe comparison without overwriting the user's working changes. If before-fix failure was not demonstrated, report that limitation.

## Execute proportionally and inspect the results

Run the targeted tests first, then related suites or other checks when their coverage is relevant. Use the actual runner's filtering and exit behavior. Verify that intended tests were discovered and executed; an empty selection, skipped suite, or zero exit code alone is not evidence of passing coverage.

Distinguish a test assertion failure, setup or infrastructure failure, timeout, and unavailable dependency. Keep the original error and identify the responsible layer before changing code or expectations.

Do not weaken assertions, remove coverage, update snapshots blindly, or suppress errors to make a suite pass. Change an expectation only when an authoritative requirement or intended contract change supports it.

For intermittent failures, investigate timing, shared state, ordering, resource cleanup, and environmental differences. Use bounded repeated runs to gather evidence when useful; a later successful retry does not erase an earlier failure or prove stability.

Keep test execution within the authorized environment. Inspect setup and cleanup behavior before operations that reset databases, call providers, send messages, or mutate shared resources. Prefer isolated fixtures and test services; do not infer permission for consequential live actions from a request to run tests.

## Report coverage and stop

Review changed tests and configuration for unintended scope or dependency changes. Use [report-template.md](references/report-template.md) to report behaviors covered, checks actually run, results, and material limitations, omitting irrelevant sections.

Distinguish tests written from tests executed, planned checks from results, mocked boundaries from real interactions, and observed coverage from general confidence. A passing suite is evidence about its exercised cases, not proof that the application has no defects.

Stop when the requested behavior has appropriate evidence or a precise blocker is identified. Continue independent authorized work, but do not fix unrelated baseline failures, redesign the application, or introduce a blanket approval gate for routine local checks.
