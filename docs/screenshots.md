# Demo screenshots

All screenshots use fictional records in a separate temporary SQLite database: Alex Morgan, two resume templates, four example employers, and a job-specific tailored copy. Match scores and chat replies are scripted illustrations, not live provider output. The capture process makes no AI requests and does not load your saved workspace or browser profile.

- [Desktop workspace and resume match](images/workspace.png)
- [Desktop chat](images/ai-chat.png)
- [Mobile resume](images/mobile-resume.png)
- [Mobile job list](images/mobile-jobs.png)

To regenerate:

```sh
npm run build
npm run screenshots
```

On macOS the script uses installed Google Chrome; elsewhere install Playwright Chromium with `npx playwright install chromium`. You can override the executable with `BROWSER_EXECUTABLE_PATH`.

To keep the isolated demo available afterward:

```sh
npm run screenshots -- --keep-open
```

Open the printed `DEMO_URL` in a fresh browser tab. Stop the process with Ctrl+C to shut down the demo server and remove its temporary database. Screenshot files remain in `docs/images/`.
