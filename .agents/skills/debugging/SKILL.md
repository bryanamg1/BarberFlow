---
name: debugging
description: Systematically investigate, reproduce, diagnose, and fix software defects, regressions, failing tests, unexpected behavior, crashes, integration failures, and runtime errors. Use when a task involves a bug, error, failure, broken behavior, regression, unexpected output, failing test, stack trace, or unexplained malfunction. Prefer evidence-driven root-cause analysis over speculative fixes.
---

# Debugging

Use this skill to diagnose software defects systematically and produce the smallest verified fix that addresses the root cause.

Do not start by changing code.

The default workflow is:

**observe → reproduce → gather evidence → form hypotheses → isolate → prove root cause → fix → regression test → validate**

Follow repository-level instructions from `AGENTS.md` and any more specific instructions applicable to the files being modified.

## Core principles

### Evidence before modification

Do not change implementation code merely because a section of code looks suspicious.

Before modifying code, gather enough evidence to explain:

- what is failing;
- where the failure becomes observable;
- what behavior was expected;
- what behavior actually occurred;
- under which conditions it occurs;
- which component is responsible.

Prefer logs, stack traces, test failures, runtime output, database state, network responses, source code, configuration and reproducible commands over assumptions.

### Reproduce before fixing

Attempt to reproduce the defect with the smallest practical scenario.

Capture:

- reproduction command or action;
- relevant input;
- expected result;
- actual result;
- error output;
- environment assumptions.

If reliable reproduction is impossible, explicitly state that and continue using the strongest available evidence.

Do not claim the bug is reproduced unless it actually is.

## Establish the failure boundary

Determine where correct behavior becomes incorrect.

Trace the relevant path through the system rather than reading unrelated code.

Depending on the problem, inspect boundaries such as:

```text
UI
↓
client state
↓
HTTP request
↓
route
↓
controller
↓
service
↓
repository
↓
database
```

or:

```text
producer
↓
queue
↓
worker
↓
external API
↓
persistence
```

Identify the narrowest known boundary between:

```text
last known correct state
        ↓
first known incorrect state
```

Use that boundary to reduce the search space.

## Gather evidence

Inspect only evidence relevant to the failing path.

Useful evidence can include:

- exact error message;
- stack trace;
- logs;
- failing tests;
- recent code changes;
- `git diff`;
- `git log`;
- runtime configuration;
- request and response payloads;
- database records;
- SQL queries;
- network calls;
- dependency versions;
- environment variables;
- timing information;
- browser console output;
- application state.

Never expose secrets while reporting findings.

Do not print authentication tokens, passwords, private keys, connection strings or sensitive environment variable values.

## Form hypotheses

After gathering initial evidence, create a small ranked set of plausible hypotheses.

Prefer hypotheses that explain all known symptoms.

For each important hypothesis determine:

```text
Hypothesis
Evidence supporting it
Evidence against it
Fastest discriminating test
```

Do not maintain a large speculative list.

Discard hypotheses when evidence contradicts them.

Do not modify production code merely to test a hypothesis when observation, temporary instrumentation or an existing test can answer the question more safely.

## Isolate the defect

Reduce the problem until the responsible component, condition or interaction is identified.

When practical, distinguish between:

- application logic;
- configuration;
- data;
- environment;
- dependency;
- infrastructure;
- concurrency;
- timing;
- integration behavior.

Check recent changes when the behavior is a regression.

Do not assume that the most recently modified file is necessarily responsible.

## Prove the root cause

Before implementing the final fix, explain the causal chain.

A valid root-cause explanation should resemble:

```text
Condition A occurs
→ component B performs behavior C
→ state D becomes invalid
→ operation E fails
→ observed symptom F appears
```

Avoid explanations such as:

```text
"This function seems wrong."
```

or:

```text
"Changing this makes the error disappear."
```

Correlation is not sufficient evidence of root cause.

## Implement the smallest safe fix

Once the root cause is established:

- change the smallest reasonable surface area;
- preserve existing contracts unless the task explicitly changes them;
- avoid unrelated refactors;
- follow existing architecture and conventions;
- preserve backward compatibility when required;
- handle relevant edge cases;
- avoid hiding errors without addressing their cause.

Do not silence failures through empty catches, arbitrary retries, broad exception suppression, disabled validation or removed tests unless the intended contract explicitly requires that behavior.

## Add regression protection

When practical, create or update a test that:

1. fails because of the original defect;
2. passes after the fix;
3. represents the real failure condition.

Choose the most appropriate test level:

```text
unit
integration
end-to-end
```

Prefer the lowest level that faithfully reproduces the bug.

Do not create a unit test that mocks away the interaction responsible for an integration defect.

## Validate the fix

Run the narrowest relevant validation first.

Then expand validation when appropriate:

```text
targeted reproduction
↓
targeted test
↓
related test suite
↓
lint / typecheck
↓
broader test suite
```

Confirm that:

- the original reproduction no longer fails;
- the regression test passes;
- related behavior remains intact;
- no unintended changes were introduced.

Review `git diff` after implementation.

## Detect incomplete fixes

Treat the fix as incomplete when any of these are true:

- the original failure cannot be explained;
- the solution only hides the symptom;
- the reproduction still fails intermittently;
- a new error replaces the original error;
- tests were weakened to make the change pass;
- unrelated behavior changed without justification;
- validation was not executed when it was available.

Do not report the issue as resolved in these situations.

## Intermittent and concurrency bugs

For intermittent failures, inspect dimensions such as:

- timing;
- race conditions;
- shared mutable state;
- retries;
- ordering;
- async control flow;
- event-loop blocking;
- locks;
- transactions;
- cache invalidation;
- network delays;
- duplicate delivery;
- idempotency.

Do not conclude that an intermittent defect is resolved based on a single successful run.

## External integrations

When the defect involves an external service, distinguish:

```text
request attempted
request accepted
operation processed
response received
result persisted
```

Account for ambiguous outcomes where the external operation may succeed even though the client receives an error or timeout.

Check idempotency and duplicate-processing risks before introducing automatic retries.

## Database defects

When databases are involved, inspect:

- actual stored data;
- schema;
- constraints;
- transactions;
- isolation;
- queries;
- indexes when performance is relevant;
- migration state;
- nullability;
- foreign keys;
- uniqueness;
- concurrency.

Do not modify production data merely to make the failing case disappear.

## Frontend defects

When debugging frontend behavior, distinguish among:

```text
server data
client cache
application state
derived state
component render
browser behavior
```

Inspect network requests and browser/runtime errors before assuming the UI component itself is responsible.

Consider:

- stale state;
- race conditions;
- incorrect effect dependencies;
- asynchronous state updates;
- hydration;
- cache invalidation;
- event propagation;
- rendering conditions.

## Backend defects

When debugging backend behavior, trace the complete request lifecycle when relevant:

```text
request
→ middleware
→ validation
→ authorization
→ controller
→ service
→ persistence/integration
→ response
```

Check:

- async control flow;
- missing `await`;
- exception propagation;
- middleware ordering;
- transaction boundaries;
- malformed assumptions about request data;
- duplicated operations;
- timeout behavior;
- retries;
- state consistency.

## Security-sensitive findings

If debugging reveals a potential vulnerability, authorization bypass, secret exposure, injection issue or other security-sensitive defect:

- avoid exploiting the issue beyond what is necessary to confirm it safely;
- minimize exposure of sensitive data;
- clearly flag the security impact;
- recommend or use the dedicated security-review workflow when available.

## Performance-related failures

Do not optimize based solely on intuition.

Collect evidence first.

Depending on the system, inspect:

- latency;
- CPU;
- memory;
- query duration;
- event-loop delay;
- request volume;
- network latency;
- queue depth;
- cache hit rate;
- render frequency.

Use the dedicated performance workflow when optimization becomes the primary task.

## Stop conditions

Stop expanding the investigation when all of the following are true:

```text
root cause identified
+
causal chain supported by evidence
+
minimal fix implemented
+
original failure no longer reproduces
+
regression protection added when practical
+
relevant validation passes
```

Do not continue refactoring unrelated code after the defect is resolved.

## Final report

Always summarize the investigation using the report format in:

`references/report-template.md`

The report must distinguish facts from remaining assumptions.

If unresolved uncertainty remains, state it explicitly.

Never claim a test, reproduction, command or validation was executed unless it actually was.
