# Planning Methodology

Consult the sections relevant to complex sequencing, discovery, or rollout. Keep the final plan proportional to the actual change.

## Ground the plan in the current system

Trace the path affected by the requested behavior. For an API feature, this might include a caller, request validation, a service, persistence, and existing tests. For a UI change, it might include routing, state, rendering, and interaction tests.

Record only findings that influence the plan. A useful evidence note identifies an inspected path and the contract or constraint it establishes. Distinguish existing behavior from the desired behavior and identify where the change belongs.

If repository access is unavailable, produce a provisional plan with explicit discovery tasks. Avoid presenting stack choices, paths, or commands as verified.

## Turn uncertainty into a bounded discovery task

Use discovery when different findings would produce different implementations. Define:

- The question to resolve.
- The evidence to inspect or experiment to run.
- The decision that depends on the result.
- A stopping condition and the next action if evidence remains unavailable.

For example, before planning retries for a timed-out payment request, determine whether the provider supports idempotency and whether the operation can already have succeeded. The result determines whether retrying is appropriate.

Avoid open-ended tasks such as "research the architecture" when a narrower question will unblock the implementation.

## Sequence around dependencies and compatibility

Prefer steps that leave the system in a coherent, verifiable state. Combine tightly coupled changes when splitting them would leave a broken contract; split a large change when intermediate states are useful and safe.

For a persisted field rename, investigate existing data, all readers and writers, migration conventions, and whether application versions overlap during rollout. If they do, consider this conditional sequence:

1. Introduce the new representation while preserving compatibility with current callers.
2. Adapt readers and writers; define any temporary synchronization behavior explicitly.
3. Backfill existing data when needed, accounting for concurrent writes and partial failure.
4. Verify the backfill and switch remaining consumers.
5. Retire the old representation only after its consumers are gone.

Do not prescribe this sequence for every migration. A local, unreleased schema may permit a much smaller change. Never assume dropping data is a reversible rollback; describe recovery requirements where data could be lost.

When independent steps could run in parallel, identify their separate file ownership and integration point if that would help execution. This observation does not itself authorize spawning agents or creating new chats.

## Link checks to acceptance criteria

A useful validation specifies a trigger and an observable result. "Run tests" alone does not explain whether the requested behavior is covered.

For example, an acceptance criterion that a user may edit only their own record should lead to checks for an owner, another user, and an unauthenticated caller at the enforcement boundary. A UI-only check cannot establish server authorization.

Choose checks for affected behavior rather than maximizing test count. Record the actual project command when discovered; otherwise identify how to find it. Mark validation as planned until execution provides a result.

## Keep risk handling actionable

Describe a risk as condition, impact, and response. For example, if old workers can still read an old payload during rollout, the plan must preserve that contract or coordinate the rollout before removal.

Prioritize risks that affect sequencing or acceptance. Avoid adding generic audits or release checklists to changes that do not need them.

## Replan from evidence

If implementation reveals a missing dependency, incompatible contract, or failed assumption, update the affected steps and their checks. Preserve the user's objective and exclusions; explain a material scope change before undertaking work outside the authorization.

Use explicit states such as pending, in progress, complete, blocked, or deferred when tracking a long-running plan. A completed edit with failing validation is not a completed step if that validation is part of its completion criteria.
