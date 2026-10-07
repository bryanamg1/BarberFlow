# Frontend Implementation Methodology

Use the sections that match the change. Keep choices grounded in the existing interface, data contract, and user flow rather than prescribing one frontend architecture.

## Trace the experience and reuse intentionally

Follow the route or entry point through layout, interactive components, data access, and feedback. Inspect neighboring screens and shared components to understand the visual system and supported variants.

Reuse a shared component when its behavior and accessibility contract fit. Extend an existing variant when appropriate; avoid changing all callers to solve a local need. Extract shared behavior after establishing common meaning, not merely similar markup.

## Assign state ownership and lifetime

Identify which values come from the server, which belong to an unsaved draft, which must survive navigation, and which are derived from other values. Keep each authoritative value owned in one place.

Use URL state for shareable navigation or filters when that matches the product's behavior. Do not put private or sensitive values into URLs to simplify state management.

Determine what resets when the selected record, route, or signed-in actor changes. An unsaved draft must not accidentally apply to a different record, and cached data should follow the application's actual identity and access boundaries.

## Handle asynchronous data without stale results

Inspect how the existing data layer keys requests, cancels obsolete work, invalidates cached results, and reports errors before adding another mechanism.

Example: a user selects filter A, then filter B, and A's response arrives last. The final interface must reflect the current filter B rather than whichever request finishes last. Use the project's supported cancellation, request identity, or data-layer behavior to maintain that relationship.

Distinguish initial loading from background refresh where they require different feedback. Keep empty results distinct from failed requests. Preserve useful data during a refresh only when it remains valid for the current context.

After a mutation, reconcile affected detail and listing views using established conventions. If the server outcome is ambiguous, avoid presenting a rollback of local state as proof that the operation did not happen. Do not introduce automatic retries for non-idempotent actions without evidence that repeating them is safe.

## Build forms around user recovery

Inspect existing field components, validation, serialization, and error handling. Distinguish omitted input, an empty string, and an explicit cleared value when the contract does.

Use shared or documented business rules rather than duplicating a guessed policy. Client validation gives feedback; server validation remains authoritative. Map server failures to useful field or form feedback without exposing internal details.

Keep recoverable input after errors. Make pending submission clear and prevent accidental repeats where relevant. Preserve the intended submit action across keyboard and pointer use.

Define how a draft is initialized and refreshed. A background fetch should not overwrite in-progress edits unintentionally. Introduce unsaved-change warnings only if the flow or project conventions require them.

## React projects

Use this section only when the inspected project uses React. Check the installed framework and library versions, routing and rendering model, and existing hooks and data patterns before relying on version-specific APIs.

Keep render-time calculations free of side effects. Derive values during rendering when no independent state is required, and reserve effects for synchronization with external systems. Verify dependencies and cleanup for effects, subscriptions, and timers that the change introduces.

Trace asynchronous closures and state updates when behavior depends on the current selection or previous state. Use stable record identity for lists whose items can move or maintain local state; do not assume a position is the record's identity.

In server-rendered projects, inspect the server/client boundary and initial output before accessing browser-only resources or introducing values that differ across rendering environments. Do not assume that every React project uses server rendering.

Avoid adding memoization or a new global store without a demonstrated need. A shared hook should consolidate actual shared behavior rather than simply move every component operation into another file.

## Accessible and responsive behavior

Prefer native semantics and the project's accessible primitives over custom controls with ad hoc keyboard handling. Check labels, focus visibility, error associations, and relevant accessible names for the affected interaction.

For a dialog or similar overlay, verify how focus enters, moves, and returns, plus how the user dismisses it when dismissal is supported. Do not assume an image of a dialog verifies those behaviors.

Exercise realistic content at the relevant viewport sizes. Inspect long labels, large numbers, text growth, narrow layouts, overflow, and interactive controls that could become unreachable. Reuse existing layout rules before introducing a parallel breakpoint system.

Keep feedback understandable without relying on color alone. Respect established motion preferences and design tokens when adding animation or status indicators.

## Verify at the boundary that matters

Use component tests for interaction and feedback, data-layer tests for request or cache behavior, and browser tests for flows spanning routing or actual browser behavior where the project supports them.

Prefer selectors that express user-facing roles and names when practical. Test outcomes rather than internal state or component implementation details. A snapshot alone does not establish that a submission, navigation, or recovery action works.

For an API-backed form, distinguish a mocked response check from a verified server interaction. Use an authorized test environment and safe fixtures for mutations; do not exercise consequential live actions merely to verify a UI change.

During browser checks, inspect console errors, relevant requests, loading transitions, and visible outcomes. State which viewports and interactions were actually inspected. A successful build does not prove responsive layout or accessibility, and a single keyboard check is not a complete accessibility audit.
