# Debugging Report

Use this format after completing a debugging task.

## Symptom

Describe the original observable problem concisely.

## Reproduction

State how the issue was reproduced.

Include only commands, actions or inputs actually used.

If reproduction was not possible, say:

`The issue could not be reproduced deterministically.`

Then explain what evidence was available instead.

## Root cause

Describe the proven or best-supported causal chain.

Prefer:

```text
A
→ caused B
→ which produced C
→ resulting in the observed failure.
```

Clearly distinguish confirmed facts from remaining hypotheses.

## Evidence

Summarize the strongest evidence supporting the diagnosis.

Examples:

```text
stack trace
logs
test failure
runtime output
database state
network response
git diff
code path
```

Do not include secrets.

## Fix

Describe what changed and why it addresses the root cause.

Mention the relevant files or components.

Avoid listing unrelated formatting or generated changes unless they matter.

## Regression protection

Describe tests created or updated.

If no regression test was added, explain why.

## Validation

Report only validation actually executed.

Example:

```text
Reproduction: PASS
Targeted tests: PASS
Related tests: PASS
Lint: PASS
Typecheck: PASS
Full suite: NOT RUN
```

Never represent an unexecuted check as passing.

## Remaining risks

State any uncertainty, untested path, environment limitation or follow-up concern.

If none are known:

`No known remaining risks within the investigated scope.`

## Changed files

Summarize the files intentionally modified and their purpose.

## Conclusion

State whether the defect is:

```text
RESOLVED
PARTIALLY RESOLVED
NOT RESOLVED
```

Base this status on evidence, not expectation.

## Next recommended step

Provide exactly one concrete next action when further work is necessary.

If the issue is fully resolved and no follow-up is required:

`No additional action required for this defect.`
