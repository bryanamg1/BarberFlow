# Debugging Methodology

This reference defines the investigation methodology used by the `debugging` skill.

Consult it when the root cause is not immediately evident, multiple hypotheses are plausible, or the defect spans several components.

## The debugging loop

Use this loop:

```text
1. Observe
2. Reproduce
3. Localize
4. Hypothesize
5. Test hypothesis
6. Establish cause
7. Fix
8. Verify
9. Protect against regression
```

The loop may repeat several times before the root cause is established.

The objective is not to make the error disappear.

The objective is to understand why the system produced the incorrect behavior and correct that cause safely.

# Phase 1 — Observe

Capture the exact symptom before interpreting it.

Record:

```text
Expected behavior:
Actual behavior:
Error:
Environment:
Relevant input:
Frequency:
Known trigger:
```

Separate observations from interpretations.

Example:

Observation:

```text
POST /payments returns HTTP 500 after approximately 30 seconds.
```

Interpretation:

```text
The payment provider is timing out.
```

The second statement is a hypothesis until supported by evidence.

# Phase 2 — Reproduce

Find the shortest deterministic reproduction possible.

Prefer:

```text
one command
one test
one request
one user flow
```

over a long manual procedure.

When reproduction depends on data, preserve enough information to understand the state without exposing sensitive information.

If the problem occurs only in a specific environment, compare that environment against one where the defect does not occur.

Useful dimensions include:

```text
development vs production
working commit vs failing commit
user A vs user B
valid data vs failing data
browser A vs browser B
dependency version A vs version B
```

Differences between working and failing cases are valuable evidence.

# Phase 3 — Localize

Find the smallest subsystem that still exhibits the defect.

Use binary elimination when useful.

For example, instead of inspecting an entire request pipeline simultaneously:

```text
Does the client send the correct payload?

YES
↓
Does the server receive the correct payload?

YES
↓
Does validation preserve it?

YES
↓
Does the service produce the expected value?

NO
```

The search space is now dramatically smaller.

Prefer finding the first incorrect state rather than merely the final exception.

# Phase 4 — Hypothesize

Create hypotheses only after initial evidence exists.

Good hypothesis:

```text
The request is processed twice because the retry executes after the
provider completes the operation but before the original response reaches
the application.
```

Weak hypothesis:

```text
Maybe the API is buggy.
```

A useful hypothesis must be testable.

Ask:

```text
If this hypothesis is true, what else should I observe?
```

Then test that prediction.

# Phase 5 — Run discriminating experiments

Prefer experiments that differentiate between competing hypotheses.

Example:

Hypothesis A:

```text
Database write is slow.
```

Hypothesis B:

```text
External API call is slow.
```

Useful experiment:

```text
Measure duration immediately before and after each boundary.
```

Poor experiment:

```text
Increase every timeout and try again.
```

Change one important variable at a time whenever practical.

# Phase 6 — Establish causality

A complete root cause identifies:

```text
trigger
+
fault
+
propagation path
+
observed symptom
```

Example:

```text
The webhook provider retries deliveries after 5 seconds
→ our endpoint performs the write before acknowledging the request
→ processing occasionally exceeds 5 seconds
→ the provider sends the event again
→ there is no idempotency constraint
→ the same payment is inserted twice.
```

This explains both why the defect occurs and why it is intermittent.

# Phase 7 — Design the fix

Evaluate the fix against the actual invariant that was violated.

Ask:

```text
What must always be true?
```

For the duplicate-payment example:

```text
One external payment identifier may result in at most one internal payment.
```

A robust solution should enforce that invariant rather than merely reduce the likelihood of duplicate requests.

# Phase 8 — Verify

Repeat the original reproduction.

Then test nearby behavior.

Check both:

```text
Does the bug disappear?

and

Did the fix create another bug?
```

If applicable run:

```text
targeted test
related tests
lint
typecheck
broader tests
```

# Phase 9 — Regression protection

Capture the failure as executable knowledge whenever practical.

A good regression test documents:

```text
the condition that triggered the defect
the behavior that must remain correct
```

This prevents the same bug from silently returning.

# Debugging anti-patterns

Avoid these behaviors:

```text
Changing several unrelated things simultaneously.

Adding arbitrary delays.

Increasing timeouts without determining what is slow.

Adding retries without checking idempotency.

Catching and ignoring exceptions.

Returning success when an operation actually failed.

Removing validation.

Weakening or deleting failing tests.

Adding null checks everywhere without determining why data is unexpectedly null.

Refactoring large areas while investigating a narrow bug.

Assuming correlation proves causation.

Assuming the last edited file caused the regression.

Stopping because the bug did not appear once.

Declaring success without rerunning the original reproduction.
```

# Useful comparison strategy

When a defect recently appeared, compare:

```text
working state
vs
failing state
```

Potential evidence:

```text
git diff
git log
configuration changes
dependency lockfiles
database migrations
environment changes
feature flags
API contract changes
```

Do not automatically revert recent changes.

Use the comparison to identify causal differences.

# Escalation to another skill

Debugging should remain focused on diagnosis and correction.

When the investigation becomes primarily about another engineering concern, combine or transition to the corresponding skill.

Examples:

```text
vulnerability discovered
→ security-review

query or runtime bottleneck discovered
→ performance

schema/index/transaction issue
→ database-engineering

large architectural flaw
→ architecture-review

large cleanup after behavior is stabilized
→ refactoring
```

Debugging establishes what is wrong and why.

The specialized skill determines the best domain-specific solution when deeper expertise is required.
