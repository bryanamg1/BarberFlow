# Pre-commit Review Methodology

Use the sections that affect the proposed commit. The goal is trustworthy evidence about a selected candidate without disturbing the user's working state.

## Identify the index and baseline

In an ordinary Git repository, useful read-only inspections include:

```text
git status --short
git diff --cached --stat
git diff --cached --name-status
git diff --cached
git diff
git ls-files --others --exclude-standard
```

Inspect sensitive paths selectively rather than dumping potentially secret-bearing diffs into a report. Read files outside the candidate only when they provide necessary context or explain a dependency.

Do not confuse an untracked file visible on disk with a file included in the commit. Likewise, a staged deletion remains a deletion even if an untracked replacement happens to make local execution work.

For a repository without a first commit, inspect the staged additions rather than requiring a comparison with an existing `HEAD`. Check unresolved conflicts before treating the index as a coherent tree. Inspect submodule revisions or large-file pointers only when they are part of the change; parent-repository tests do not automatically validate their underlying content.

Record a stable candidate identity when possible. An index tree identifier can establish staged-content identity, but says nothing by itself about the environment used for testing.

## Partial staging and execution evidence

Compare staged and working versions of changed files, including tests and configuration. Three common mismatches are:

- A fix is unstaged, so local tests pass while the candidate still contains the bug.
- A new helper or fixture is untracked, so local execution succeeds but a fresh checkout cannot run.
- A lockfile or generated client differs locally, so installed dependencies or API bindings do not represent the candidate.

When candidate-specific execution is necessary, use an available isolated snapshot of the complete index within permitted scratch space. Include unchanged tracked files and relevant file metadata, not only changed paths. Verify the snapshot's contents and record dependency/configuration provenance. Do not copy secrets into a disposable snapshot merely to make checks run.

Choose an isolation mechanism that respects repository requirements and permitted side effects. Do not change the user's checkout, stash their work, manipulate their index, or perform an incidental network installation. If faithful isolation is unavailable, retain useful static review and working-tree evidence, but label the remaining candidate-validation gap.

Even with identical tracked files, ignored or untracked inputs may affect results. State material assumptions about local services, generated artifacts, environment variables, and installed dependencies.

## Scope and accidental content

Ask whether each included change supports the stated purpose, rather than requiring every commit to contain one file or one kind of change. A cross-layer feature can be a coherent unit.

Check relevant companion changes:

- Dependency manifests and lockfiles follow the project's package-manager convention.
- Schema changes include the migration or compatibility handling required by the project.
- Changed contracts have compatible consumers or an intentional transition.
- Tests and documentation describe the proposed behavior rather than an unstaged future version.
- Generated files are included or excluded according to the actual build and repository policy.

For possible secrets, report the path and type of exposure with values redacted. Scanner output is a lead to verify, not proof that every match is a credential or that no matches means no secrets. Do not use discovered credentials or rotate them as part of a review-only request. If exposure is credible, identify the handling needed separately from removing the file from a candidate.

## Select and interpret checks

Inspect project commands and their implementation where necessary. A command named `check` may modify files or call external services. Existing hooks are evidence of project expectations, not permission to run them without considering their effects.

Map checks to changed behavior and explicit repository requirements. For example, documentation edits may need link or format checks, while a shared type change may require consumer type checks. Avoid demanding unrelated expensive suites without a demonstrated reason.

For each executed check, retain:

- The command, relevant environment, and candidate or working-tree identity.
- Whether the intended tests or targets actually ran.
- Pass, fail, skipped, or unavailable status with the material output summarized.
- Whether the result applies directly to staged content or only provides provisional evidence.

When a check fails, distinguish a reproduced pre-existing failure, a candidate regression, and an unresolved cause. Do not fix unrelated failures or suppress required checks just to produce a green decision. A missing required check prevents claiming complete validation even if static inspection finds no defect.

## Evidence freshness and handoff

Reinspect staging and relevant file state after checks, especially if tools generated output or another process could have changed inputs. Candidate identity alone is insufficient if the tested working files or dependencies changed. Re-run only checks invalidated by the change when their dependencies are understood.

Give blockers a concrete condition, impact, verified location, and practical next step. Distinguish optional improvements from defects and from missing evidence. If no blockers were found, state the reviewed scope and remaining uncertainty rather than promising that a commit is safe in every environment.

Do not create or amend a commit, stage a correction, bypass hooks, or push based solely on a positive review. Those actions require their own authorization and must use the content actually selected for them.
