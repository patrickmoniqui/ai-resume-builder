# Security

## Supported use

Resume Builder is intended for one user on a trusted computer, listening on loopback. There is no remote authentication, tenant isolation, or hosted deployment security model. Keep local CLI subscription connections disabled on shared servers. Public hosting requires a separate security design.

Workspace databases, snapshots, exports, resumes, and browser storage can contain personal information. The SQLite database and backups are not encrypted. API keys are stored in browser local storage, not in ordinary workspace exports. Disconnect AI to remove the saved connection from that browser. Never attach real workspaces, original resumes, provider credentials, or unreviewed screenshots to public issues.

AI requests share content with the selected provider. Chat can send all saved resumes, jobs, notes, original document text, and recent conversation. Only connect providers and import reference material you are comfortable using this way.

## Reporting a vulnerability

Please do not post exploit details, secrets, or personal data in a public issue. Use this repository's **Security → Advisories → Report a vulnerability** if private reporting is enabled. If it is unavailable, ask the maintainer to enable private reporting without including sensitive details.

Include the affected version, impact, and minimal reproduction using synthetic data. There is no guaranteed response time or formal security support commitment.

## Dependency review

Run `npm audit` before a release and review all severities. CI blocks high and critical advisories; a passing build is not a complete security assessment.

The preparation audit on 2026-10-14 reported three moderate findings in the `mammoth → argparse → sprintf-js` chain (GHSA-hp3w-g68c-fv3c, unbounded precision denial of service). No high or critical findings were reported. The app uses Mammoth's document API; `argparse` is used by Mammoth's CLI. This does not prove the dependency is safe in every context. npm suggested an incompatible downgrade to Mammoth 0.3.29, which was not applied. Recheck upstream fixes before release and avoid using the vulnerable CLI with untrusted format input.
