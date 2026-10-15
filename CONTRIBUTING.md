# Contributing

Use Node.js 22.18+ (`nvm use` selects the tested version), then run `npm ci` and `npm run dev`.

Before changing Next.js code, read `AGENTS.md` and the relevant installed documentation in `node_modules/next/dist/docs/`. Keep persistence, import/export, and AI changes compatible with existing saved workspaces.

Use synthetic resumes, fictional employers, and `example.com` addresses in fixtures. Do not add local databases, exports, private documents, credentials, or screenshots from a real workspace. `.env.example` should contain empty values or documented non-secret defaults.

Before submitting:

```sh
npm run check:public
npm run typecheck
npm test
npm run build
npm run test:storage:browser
```

The storage browser suite uses a temporary directory and free ports. Do not run legacy feature browser scripts against a personal database. Include the behavior change, relevant validation, and any migration or recovery implications in a pull request.

Use the security reporting process in [SECURITY.md](SECURITY.md) for vulnerabilities.
