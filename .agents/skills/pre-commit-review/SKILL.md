---
name: pre-commit-review
description: Review the proposed contents of a local commit for scope, accidental files, actionable defects, and required validation. Use when asked to check staged changes or readiness before committing. Distinguish index contents from working-tree changes; reviewing does not authorize staging, committing, or pushing.
---

# Pre-commit Review

Assess the actual proposed commit, not merely the current files on disk. Report whether its scope and validation support proceeding, with concrete blockers and explicit limits.

## Establish the candidate

- Read applicable `AGENTS.md`, the requested change, and the project's relevant validation instructions. Inspect repository status before reviewing.
- Distinguish staged, unstaged, and untracked changes. By default, the index defines the next ordinary commit; a different user-specified candidate must be identified explicitly.
- Review staged contents against the appropriate baseline, including additions, deletions, renames, and file-mode changes when relevant. Handle an initial commit without assuming `HEAD` exists.
- Record the candidate identity using an available tree identifier or equivalent file/content evidence. Unresolved index conflicts prevent an ordinary commit candidate from being complete.
- If nothing is staged, say so. Review working changes provisionally if useful, but do not stage them or describe them as a validated staged commit.

For partial staging, inspect both versions of affected files. An unstaged correction may hide a defect in the staged version, and an unstaged dependency may make an incomplete candidate appear functional.

## Check scope and coherence

Compare the candidate with the user's intended change. Identify unrelated edits and missing companion changes such as tests, migrations, generated outputs, lockfiles, or documentation when the project requires them.

Inspect likely accidental additions, including credentials, local configuration, debug output, caches, backups, and large artifacts. Judge generated files and binaries by repository conventions rather than banning them universally. Redact sensitive values in findings; never reproduce a discovered credential.

Trace changed behavior far enough to identify actionable defects or incompatible contracts. Keep this focused on the candidate; a comprehensive architecture or security audit is not a prerequisite. Report reachable failures and concrete consequences rather than stylistic preferences.

Consult [methodology.md](references/methodology.md) when partial staging, candidate isolation, sensitive files, or validation provenance affect the decision. Read only the relevant sections.

## Validate the content being reviewed

Select checks from repository instructions, scripts, CI configuration, and the risks of this change. Distinguish required checks from additional useful evidence; do not invent a universal requirement to run every test or build.

Before execution, inspect unfamiliar commands for side effects. Prefer check-only modes during a review. Do not implicitly run write-mode formatters, install dependencies, execute migrations, contact production, or install hooks.

Identify what each check actually exercises:

- Working-tree checks validate the files currently on disk, which may differ from the index.
- Checks in an isolated candidate snapshot can validate staged contents if required tracked files, dependencies, and configuration faithfully represent that candidate.
- Existing CI results apply only to their recorded revision and environment, not automatically to new local changes.

When working files differ from the candidate, use a suitable isolated snapshot within the authorized environment if practical, or explain the validation gap. Do not stash, reset, overwrite, or alter staging to manufacture a clean test state.

Record actual commands, results, and relevant omissions. A skipped check, an unavailable environment, or a test selection that ran no tests is not a pass. Separate demonstrated baseline failures from candidate-introduced failures without dismissing an unresolved required check.

After validation, confirm the candidate and relevant validation inputs still match what was inspected. If files or staging changed, reassess affected evidence rather than reusing stale results.

## Preserve authorization boundaries

A review-only request does not authorize implementation edits, staging, commits, amendments, hook bypasses, or pushes. Offer concrete corrections without performing them unless the user has authorized that work.

If fixes or a commit are already authorized, continue only within that scope. Recheck the final selected content after fixes; do not include unrelated user changes through blanket staging. Authorization to commit does not imply authorization to push.

## Deliver the decision

Lead with one of these conclusions, adapted to the user's format:

- Ready within the reviewed scope, when the identified candidate has adequate relevant evidence and no unresolved blockers.
- Needs changes, when concrete defects, accidental content, or unresolved conflicts prevent proceeding.
- Validation incomplete, when necessary evidence is missing or does not apply to the candidate.
- No staged candidate, when there is no prepared commit to assess.

Separate blockers from optional improvements. State what was reviewed, what was actually validated, and the smallest next action. Do not certify the repository as bug-free or claim a commit was created when only a review occurred.

Use [report-template.md](references/report-template.md) when a structured handoff is helpful. Omit irrelevant sections and follow any user-requested output format.
