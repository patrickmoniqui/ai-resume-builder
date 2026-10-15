# Publishing to GitHub

The source is prepared for a fresh public repository. No remote publication is performed by the preparation process.

1. Run the README checks and review `npm audit`, including moderate findings documented in `SECURITY.md`.
2. Run `git status --short --untracked-files=all` and `git ls-files --cached --others --exclude-standard`. Inspect every candidate, including binary fixtures and any screenshots. `.env.local`, local agent configuration, build output, `tmp/`, test artifacts, and databases must stay excluded. Never use `git add -f` for these.
3. Choose a license before advertising the project as open source. Until a license is added, reuse rights remain reserved.
4. If adding screenshots, generate them from synthetic records and check visible names, jobs, paths, notifications, and browser chrome. The test DOCX is synthetic; never replace it with a personal resume.
5. Stage reviewed files with `git add .`, inspect `git diff --cached --stat` and `git diff --cached`, then create the initial commit.
6. Create the GitHub repository and push the reviewed commit. Add a concise description and relevant topics such as `nextjs`, `typescript`, `resume-builder`, `sqlite`, and `local-first`.
7. Enable private vulnerability reporting and available secret-scanning/push-protection settings. Require the CI workflow before merging changes. Confirm Actions succeeds on the first push.

If a credential is ever committed or pushed, revoke it at its provider immediately. Removing the current file does not remove Git history. Review history and rotate exposed credentials before changing repository visibility.

Keep `.env.local`, existing private exports, and the external workspace database on your machine. They are excluded rather than deleted, so public preparation does not erase your work.
