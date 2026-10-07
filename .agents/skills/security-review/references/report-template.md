# Security Review Report

Adapt this guide to the surface reviewed. Lead with actionable findings and omit irrelevant sections. Do not include secret values, private record contents, or unnecessary exploit detail.

## Findings

Order findings by practical risk. For each material finding, provide:

- Title and severity, with a brief justification based on impact and prerequisites.
- Evidence and location, using inspected paths and verified line numbers where available.
- Actor, controlled input or action, and failed security boundary.
- Realistic consequence and affected scope, separating established facts from conditional impact.
- Confidence and verification status, distinguishing code inspection from test reproduction.
- Smallest reasonable remediation and a targeted regression check.

Group affected paths that share the same root cause when appropriate. Separate confirmed defects, conditional concerns, and optional hardening. Do not invent findings to fill this section.

If none were identified, state that no actionable findings were found within the inspected scope. If evidence is insufficient for a conclusion, say which decision remains unresolved instead of presenting a clean result.

## Scope and approach

State the change or component reviewed, relevant assets and trust boundaries, inspected evidence, environments used, and exclusions. Distinguish source inspection from assumptions about deployment.

## Verification

Report only checks actually executed, their results, and the relevant environment. Distinguish scanner leads from validated findings and mark proposed or unavailable checks as not run.

For active checks, summarize the bounded verification and synthetic fixtures used without exposing sensitive data. Do not imply that authentication, access, or an exploit was tested if only source was inspected.

## Remediation status

Include this section only when remediation was authorized or its status is relevant. Distinguish proposed changes, implemented changes, verified fixes, and deployment status. Describe credential rotation as recommended or actually performed, according to evidence.

## Limitations and next action

State meaningful blind spots, unresolved prerequisites, or unavailable configuration and their effect on confidence. Identify the next concrete action when necessary. A focused review does not certify the entire system as secure.
