# Security Review Methodology

Use the dimensions that match the inspected surface. Begin with a small threat model and follow actual trust boundaries rather than generating a generic vulnerability checklist.

## Define the actor and security boundary

Identify the protected asset, the actor's legitimate access, what the actor can control, and the operation that crosses a trust boundary. Compare the observed behavior with the established product and access contract.

A useful finding explains the chain from actor-controlled input or action through the failed control to an unauthorized result. If reachability, authority, or the expected restriction is unknown, record the concern and missing evidence without asserting a confirmed exploit.

## Identity, sessions, and authorization

Trace how identity is established and used for the affected operation. Distinguish authentication from permission to act on a particular record, tenant, field, or state transition.

Inspect relevant token or session verification, middleware order, role checks, ownership queries, and update field restrictions. Determine whether sensitive authority is derived from trusted context or user-controlled input.

For database policies or privileged internal callers, check the effective execution role and the actual path used by the application. Do not treat a successful administrator test as verification that ordinary callers are restricted.

Use local fixtures for an allowed actor and a disallowed actor when testing. A hidden button or a rejected anonymous request does not establish that one authenticated user cannot act on another user's record.

## Untrusted input and dangerous operations

Trace relevant external input to SQL, command execution, templates, dynamic code, file paths, or other sensitive operations. Inspect the actual library and composition method before concluding that input becomes executable syntax.

Distinguish parameterized values from identifiers or fragments constructed separately. Check validation and supported allowlists at the actual boundary rather than assuming that parsing input establishes safety.

For updates and serialization, inspect allowed input and returned fields. A caller-controlled object should not gain write access to privileged fields or reveal private fields merely because it matches an internal model.

## Browser trust and cross-origin behavior

Inspect where untrusted content is rendered and the encoding or sanitization applied to its actual context. A framework's default rendering may protect one path while a raw rendering API or another context requires different treatment.

For request forgery or cross-origin concerns, establish the authentication mechanism, browser credential behavior, affected action, and existing controls before asserting exposure. A permissive-looking CORS setting alone does not establish every kind of unauthorized action.

For redirects, cookies, and browser storage, relate the observed configuration to a realistic consequence. Avoid prescribing headers or storage changes without considering the project's rendering and deployment context.

## Outbound requests, files, and uploads

For actor-controlled outbound destinations, inspect destination validation, redirects, name resolution behavior, and accessible network resources where relevant. Establish the permitted destination contract and whether the actual path can reach a forbidden target.

For file handling, trace path construction, containment, permissions, accepted content, storage, and serving behavior as applicable. File names, extensions, and client-declared content types are evidence to inspect, not proof that stored content is safe to execute or serve.

Confirm with synthetic local resources or scoped test fixtures when possible. Do not contact internal metadata endpoints, scan networks, or upload dangerous content to a live service solely to verify a source-level concern without authorization for that action.

## Secrets and sensitive data

Inspect the relevant path for credentials in source, logs, client bundles, error responses, or artifacts. Distinguish placeholders and public identifiers from likely secrets before assigning impact.

Do not print discovered secret values, copy them into a report, or use them to authenticate. Report the location and evidence about exposure with redaction. Avoid sending private source, payloads, or credentials to an external scanner without authorization for that disclosure.

If exposure is credible, recommend revocation or rotation and an assessment of the actual exposure scope. Do not imply that deleting a file or rewriting a local value resolves already distributed copies or provider-side validity.

## Dependencies and configuration

Inspect lockfiles and the actual dependency or configuration path relevant to the concern. Distinguish development tooling, bundled client code, and reachable server behavior.

Verify advisory details through current vendor or maintainer sources when needed. Establish affected versions, enabling conditions, and available remediation. A scanner alert is not proof of reachability; absence of alerts is not proof that the application is secure.

Check the effect and compatibility of a proposed upgrade rather than recommending an unverified major-version jump as a completed fix. Do not introduce an external scanning service or upload repository content by default.

## Abuse and resource consumption

Consider costly unauthenticated work, unbounded input, repeated effects, or missing limits when the inspected operation makes them relevant. Explain the realistic resource or business impact and existing upstream protections.

Use bounded local checks or existing measurements. Do not run denial-of-service, brute-force, or high-volume tests against a live service as a routine review step. Avoid universal rate limits or arbitrary thresholds unsupported by product requirements or evidence.

## Severity and confidence

Use a project's defined rating scheme when available. Otherwise explain severity in plain terms:

- Critical: plausible conditions permit broad compromise or comparable impact with few meaningful barriers.
- High: substantial unauthorized access or action is supported by the evidence, with stated prerequisites.
- Medium: meaningful exposure has constrained impact or significant enabling conditions.
- Low: limited security impact is supported by a concrete scenario.

These labels are qualitative, not an automatic score. Explain the actual scope, actor access, and conditions behind the rating. Do not assign a numeric standard score unless its required inputs have been established.

State confidence independently, including whether the path was traced, locally reproduced, or depends on unknown deployment facts. Keep optional hardening separate from vulnerabilities; an informational suggestion need not have a vulnerability severity.

## Correction and regression evidence

Address the root enforcement failure and check that legitimate behavior remains possible. For an ownership defect, the denied cross-owner action should fail without changing data while the legitimate owner action still works.

Distinguish a proposed test, a failing test that reproduces the issue, and a passing test after an authorized fix. A source change without executed verification is not a verified remediation, and a local fix is not a deployed fix.
