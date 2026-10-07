---
name: frontend-development
description: Implement or extend web interfaces, components, forms, navigation, and client data flows in the project's existing frontend stack. Use for frontend delivery with responsive behavior, accessibility, state, and API integration. Use feature-design for unresolved product behavior and debugging for unexplained defects before choosing a repair.
---

# Frontend Development

Deliver the requested interface and interaction behavior in the project's stack and design system. Verify what users can see and do, not just whether components compile.

## Establish the affected experience

- Read applicable `AGENTS.md`, the supplied specification, and relevant design references. Inspect the working tree before editing an existing repository.
- Trace the affected route, components, styles, state, data hooks or services, and related tests. Identify existing shared controls and layout conventions before adding alternatives.
- Identify the user goal, acceptance criteria, navigation, data contract, relevant permissions, and required interaction states.
- Distinguish verified behavior, requested changes, and assumptions. Resolve missing business decisions that affect correctness without redesigning unrelated screens.
- Use a short implementation plan when dependencies warrant it. Keep a straightforward interface change lightweight.

For a new interface, follow the user's chosen stack and visual direction. When these are unspecified, make coherent, minimal choices and state material assumptions. Do not introduce a component library, state framework, or routing system solely because it is familiar.

## Structure components and state intentionally

Keep rendering, interaction state, data access, and business decisions at appropriate boundaries in the existing architecture. Reuse shared components where their semantics fit; avoid generalizing a one-off interaction into a speculative framework.

Identify the owner and lifetime of each state value. Distinguish server data, local edits, URL state, and derived values. Avoid duplicated sources of truth and state that can be computed directly unless the requirement needs a separate snapshot.

Use the project's established fetching, cache, and mutation conventions. Account for stale responses and changes to request inputs, actor, or route when they affect which data should be displayed. Define loading, refresh, empty, error, and success behavior only where relevant to the flow.

Read [methodology.md](references/methodology.md) for forms, asynchronous data, React behavior, or browser verification when those concerns are part of the task. Consult only the relevant sections.

## Integrate the actual contract

Inspect the existing API client, types, and relevant server contract. Preserve established request fields, response handling, error mapping, and access scope. Do not assume a missing endpoint or response field exists.

Treat mock data and local placeholders as development aids, not completed integration. If a backend dependency is unavailable, identify the affected behavior and continue independent interface work without claiming an end-to-end result.

For mutations, prevent accidental repeated submission where appropriate and provide feedback based on the actual outcome. Use optimistic updates only with an explicit reconciliation or recovery path consistent with the operation. A cancelled client request does not establish that a server-side action was undone.

UI visibility and disabled controls communicate permissions; server enforcement remains necessary. Do not put secrets in client code or expose sensitive values through debug output.

## Implement usable interactions and layout

Preserve the existing visual system unless a redesign is requested. Use its spacing, typography, colors, and component variants consistently. Verify layout with realistic content and the relevant narrow and wide viewport conditions.

Prefer semantic controls and established accessible components. Provide meaningful labels, keyboard interaction, visible focus, and understandable feedback for the affected flow. For overlays or dynamic navigation, handle focus entry and return according to the interaction rather than only making it look correct.

For forms, connect labels and validation feedback to their fields, preserve useful input after a recoverable failure, and make submission status clear. Reuse established validation rules; do not invent business constraints on the client.

Handle text growth, long content, empty data, and overflow where they can break the requested layout. Avoid device-specific assumptions or arbitrary breakpoints when the existing layout system provides a suitable pattern.

## Validate behavior and appearance

Add or update tests where the project has an appropriate setup, prioritizing user-observable behavior and the boundary that could fail. Cover relevant successful and unsuccessful interactions rather than only checking that a component renders.

Run targeted checks first and expand to related tests, type checks, lint, or build checks as warranted by the change. Use discovered project commands. Do not add an unrelated test framework when none exists.

When browser access is available, exercise the affected flow and inspect relevant viewport states, focus behavior, runtime errors, and network outcomes. A screenshot can establish appearance but cannot establish keyboard behavior or a completed server mutation. If browser verification is unavailable, state the unverified interactions explicitly.

Use measurements before adding performance mechanisms such as memoization, virtualization, or new caching. Keep optimization proportional to observed behavior or an explicit requirement.

Review the final diff for unrelated changes, accidental dependencies, and contract compatibility. Update relevant component, interaction, or configuration documentation when needed.

Use [report-template.md](references/report-template.md) to summarize delivered behavior, checks actually executed, and remaining limitations. Omit irrelevant sections and distinguish mocked, automated, and browser verification.

Stop when the requested flow and relevant validation are satisfied. Keep unresolved portions visible and continue independent authorized work. A design-only or review-only request does not authorize implementation; implementation does not imply permission to publish, deploy, or commit.
