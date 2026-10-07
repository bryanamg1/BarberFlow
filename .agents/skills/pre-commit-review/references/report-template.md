# Pre-commit Review Report Template

Adapt this template to the size of the candidate and the user's requested format. Replace guidance with actual evidence, omit irrelevant sections, and keep small reviews short.

## Decision

State whether the candidate is ready within the reviewed scope, needs changes, has incomplete validation, or does not exist because nothing is staged. Give the main reason without implying a commit was made.

## Candidate and scope

- Intended change and repository context.
- Staged candidate identity and comparison baseline, including an initial commit if applicable.
- Included areas and relevant unstaged or untracked content excluded from the candidate.
- Partial staging or conflicts that affect review confidence.

## Blockers

For each actionable blocker, provide:

- Verified file/location in the reviewed version.
- Reachable failure, accidental inclusion, or missing requirement.
- Concrete impact and supporting evidence, with sensitive values redacted.
- Smallest corrective action and any decision needed from the user.

If none were found, say so within the reviewed scope. Keep optional improvements separate.

## Validation

| Check | Execution source | Actual result | Applies to candidate? |
| --- | --- | --- | --- |
| Actual command or inspection | Working tree, isolated index snapshot, or identified CI revision | Pass, fail, skipped, or unavailable with relevant detail | Direct evidence or a specific limitation |

State whether the intended targets ran, material environment assumptions, and required checks left incomplete. Explain baseline failures separately from demonstrated regressions.

## Freshness and next action

Confirm whether the candidate and validation inputs remained unchanged. Identify evidence invalidated by subsequent changes. State the next action without silently staging, committing, or pushing.
