# Security Policy

## Reporting Vulnerabilities

Please report security issues privately instead of opening a public issue.

Email: security@thegrid.ai

Include:

1. A description of the issue and affected component.
2. Steps to reproduce or a proof of concept, if available.
3. Any known impact, affected versions, or mitigations.

We will acknowledge reports as soon as possible and coordinate fixes before
public disclosure.

## Secrets and Credentials

AgentSea provisions real cloud resources. Never commit:

- `.env` files or local credential overrides.
- Cloud provider tokens.
- SSH private keys or PEM files.
- Generated CLI/provider bundles or e2e logs that may contain runtime output.

If a secret is accidentally committed or shared, rotate it immediately and open a
private security report with the relevant details.
