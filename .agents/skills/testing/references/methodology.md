# Testing Methodology

Consult the sections that help test the actual behavior. The goal is useful failure detection and trustworthy execution evidence, not a fixed test count or percentage.

## Establish an independent expected result

Use acceptance criteria, documented contracts, domain invariants, or an agreed example to establish expected behavior. Inspect the implementation to select meaningful cases without reproducing the same calculation as the test oracle.

When requirements and current tests conflict, identify the disagreement. Do not silently treat either existing implementation or an old assertion as the desired contract.

If a business rule is missing, identify the affected case and continue testing independently specified behavior. Do not invent a policy to complete a fixture or make an assertion pass.

## Choose the boundary that can reveal the failure

Use unit tests for isolated transformations or decisions, integration tests for contracts between real components, and end-to-end tests for representative user or system flows.

For example, an ownership-restricted update requires evidence that a disallowed caller cannot change the record. A test of a hidden button does not establish server authorization. A mocked write that always succeeds does not establish a uniqueness constraint.

Avoid duplicating every case at every level. Keep detailed rule permutations near their owning component and use broader tests for wiring, contracts, and critical paths they can uniquely verify.

## Use deliberate doubles and fixtures

Mock nondeterministic or unavailable external boundaries when that enables a focused test, and state what remains unverified. Keep the behavior under test real.

Make simulated responses reflect an inspected contract. For external APIs, a fake response is not evidence that the live provider accepts the request or produces that response.

Keep fixtures minimal enough to make the failure condition visible. Include relationships, roles, and state required for the case rather than building an unrelated production-sized dataset.

Use isolated databases, schemas, transactions, or project-supported fixture cleanup where suitable. Inspect cleanup scope; a shared database reset is not interchangeable with deleting one test-owned record. Preserve the original assertion failure if cleanup also fails.

## Prove regression detection

Where a known bug is available, create a test that exercises its triggering condition and asserts the intended behavior. Establish that it fails because of that defect and passes after the correction when practical.

Use a safe isolated workspace or reproduction to compare prior behavior if needed. Do not reset, check out over, or temporarily discard unrelated user changes to obtain a failing state.

A fixture setup error or unavailable service is not a demonstrated regression failure. If only the corrected state was exercised, say that before-fix detection remains unverified.

## Check more than a superficial success signal

Assert the relevant response or visible outcome and the important state changes. For a denied update, assert that data remains unchanged. For an atomic operation, assert that a later failure does not leave forbidden partial state.

For query or migration behavior, use a representative existing state when required; a fresh database can hide upgrade defects. For a UI flow, exercise the actual interaction, navigation, or recovery path instead of only checking initial rendering.

Use snapshots only where they represent a deliberate stable contract. Review their changes for meaning; updating a snapshot is not itself a fix.

## Make asynchronous behavior observable

Await the action and its relevant completion. Ensure failures from promises, callbacks, workers, or browser actions reach the test runner rather than occurring after the test has already passed.

Use fake clocks or supported synchronization for timing-dependent behavior when they faithfully model the requirement. Prefer waiting for a relevant observable state over a guessed sleep duration.

For concurrency, coordinate competing operations so the critical overlap is exercised when practical. A sequential duplicate test may protect idempotency but does not by itself establish correctness under a race.

Restore timers, subscriptions, connections, and other test-owned resources after execution. Check order dependencies when a test passes alone but fails in a suite.

## Diagnose flaky and environmental failures

Record the failing command, selected tests, error, seed when relevant, and environmental prerequisites without printing secrets. Compare isolated and suite execution only when that comparison can answer a concrete question.

Investigate shared mutable state, clock assumptions, test order, resource limits, unresolved async work, and nondeterministic external responses as applicable. Do not increase all timeouts or introduce retries without understanding what failed.

Use a bounded reproduction attempt with a clear question and stopping condition. Report both failures and later passes; a retry policy may mask a defect rather than resolve it.

Keep baseline failures separate from new failures. Diagnose enough to explain their effect on the requested validation without automatically expanding the task into unrelated repairs.

## Evaluate coverage without substituting a metric for behavior

Use coverage output, when available, to locate unexercised relevant branches and missing failure paths. Do not invent a coverage percentage or establish a universal target unrelated to the project.

A high line percentage can coexist with weak assertions or mocked-away interactions. A small behavioral test that detects a meaningful regression may add more confidence than broad execution without useful assertions.

Document important untested boundaries and why they matter. Distinguish an intentional omission for a low-impact change from an environment limitation that prevents a necessary check.

## Verify execution evidence

Check test discovery and the actual summary as well as the process exit code. Identify skipped, cancelled, timed-out, or unavailable tests when they affect the requested coverage.

Separate test results from lint, type checks, build output, and manual inspection. Each supplies different evidence; one cannot silently substitute for another.

Record commands, relevant prerequisites, and results sufficiently for another developer to reproduce the check. State a partial result when only a filtered subset or simulated environment was exercised.
