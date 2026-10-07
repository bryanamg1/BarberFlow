# Feature Design Methodology

Use the sections that help resolve the feature's actual behavioral questions. A feature does not need every dimension below.

## Separate need, policy, and mechanism

Start with the outcome the user needs. Distinguish a product requirement from a proposed implementation.

For example, "a customer can cancel an eligible booking" describes a capability. The cancellation window and refund treatment are business decisions. An endpoint, table layout, or modal is an implementation proposal unless explicitly required.

Preserve a user-mandated mechanism as a constraint. When policy is missing, identify the decision and the flows it affects rather than choosing a familiar industry rule.

Use a small decision note for material ambiguity: question, evidence available, affected behavior, and proposed options if helpful. State whether an option is a recommendation or an accepted requirement.

## Model actors and access

Identify who initiates an action and who or what is affected. Use the project's existing actor and role definitions when available.

For an access-sensitive action, distinguish:

- Capability: whether the actor may perform this kind of action.
- Record scope: ownership, organization, tenant, or another applicable boundary.
- State restrictions: whether the action is allowed on this record now.

A hidden button describes UI behavior; it does not define enforcement of a permission. Specify the required result for a direct request from an unauthorized actor where relevant, without prescribing an enforcement mechanism prematurely.

## Describe lifecycle transitions

For a stateful feature, a compact transition table can expose gaps:

| Current state | Action and actor | Preconditions | Next state | Effects | Invalid-case result |
| --- | --- | --- | --- | --- | --- |
| Name the starting state | Name the requested action | State the applicable rule | Name the resulting state | Describe stored and external effects | Describe observable rejection or recovery |

Use the real domain states. Do not add an approval, archived, or pending state merely because other products use one.

Distinguish an entity's lifecycle from transient UI states. A loading indicator does not necessarily imply a persisted processing state.

## Examine overlapping actions and external effects

When an operation can be repeated or race with another operation, identify the invariant that must survive. Relevant cases might include a duplicate submission, a cancellation competing with completion, or another user editing the same record.

For an external operation, distinguish requested, accepted, completed, and locally recorded outcomes only where those distinctions matter. A timeout may leave the outcome unknown; do not specify an automatic retry as safe without evidence about duplicates and idempotency.

Define the observable result and recovery expectation before selecting locks, queues, transactions, or retries. If the correct outcome depends on an unresolved provider contract, record that dependency and leave the affected decision open.

## Define data and interface expectations

Specify the meaning of required input and output, relevant validation, and what data is created, changed, or retained. Identify compatibility with existing consumers when changing a contract.

For time or money, use established project rules for timezone, rounding, currency, and effective dates. Ask about material gaps rather than inventing a policy.

For UI work, define relevant empty, loading, success, error, and recovery behavior. Include keyboard interaction or other accessibility expectations when they affect the requested flow. Keep visual styling proposals separate from business rules.

## Derive acceptance criteria from behavior

A criterion should allow an implementer or tester to distinguish correct behavior from incorrect behavior without guessing.

Conditional example, assuming the specification explicitly permits owner cancellation before a booking starts:

- Given an eligible booking owned by the caller, when the caller cancels it, then the booking becomes cancelled and the response reports that result.
- Given the same booking owned by another caller, when that caller requests cancellation, then access is denied and the booking remains unchanged.

These criteria do not establish a cancellation policy for other projects. Add duplicate, timing, or external-failure cases only if they influence this feature's outcome.

For a larger specification, short rule and criterion identifiers can make coverage visible. For a small feature, a short list is sufficient.

## Assess readiness without hiding uncertainty

Check that required flows have outcomes, important rules have acceptance criteria, and contradictions are resolved or explicitly visible.

Identify which missing decisions block implementation and which reversible assumptions allow progress. Do not force the entire task to wait for an optional enhancement, and do not label blocked behavior ready to build.

Hand off the outcome, scope, rules, acceptance criteria, integration constraints, and open decisions to implementation planning. Carry uncertainties forward instead of silently resolving them during the handoff.
