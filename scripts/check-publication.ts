import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Report file names and rule names only; never print a matched credential.
export function publicationIssues(file: string, content: string): string[] {
  const issues: string[] = [];
  if (
    /(^|\/)(?:node_modules|\.next|test-results|playwright-report|tmp|backups|data|\.aws|\.codex|\.claude|\.agents)(\/|$)/.test(
      file,
    ) ||
    (/(^|\/)\.env(?:\..*)?$/.test(file) && file !== ".env.example") ||
    /\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm|journal))?$|\.(?:pem|key|p12|pfx)$|\.tsbuildinfo$/i.test(
      file,
    )
  )
    issues.push("private or generated file");
  if (
    (/\.(?:pdf|docx)$/i.test(file) && !file.startsWith("tests/fixtures/")) ||
    /(^|\/)resume-builder-(?:backup|browser|unsaved).*\.json$/i.test(file)
  )
    issues.push("personal document or workspace export");
  const rules: [string, RegExp][] = [
    [
      "private key",
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
    ],
    ["provider API key", /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{32,}\b/],
    [
      "GitHub token",
      /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/,
    ],
    ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
    ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    [
      "personal absolute path",
      /\/(?:Users|home)\/(?!runner(?:\/|\b))[A-Za-z0-9._-]+\//,
    ],
  ];
  for (const [name, pattern] of rules)
    if (pattern.test(content)) issues.push(name);
  return issues;
}

export function checkPublication() {
  let files: string[];
  try {
    files = [
      ...new Set(
        execFileSync(
          "git",
          ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
          { maxBuffer: 16 * 1024 * 1024 },
        )
          .toString()
          .split("\0")
          .filter(Boolean),
      ),
    ];
  } catch {
    console.error(
      "Publication check needs a Git repository. Run git init first.",
    );
    return 1;
  }
  let failures = 0;
  for (const file of files) {
    let issues: string[];
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) issues = ["symlink needs manual review"];
      else {
        const bytes = readFileSync(file);
        // Binary fixtures need manual review; path rules still apply to them.
        issues = publicationIssues(
          file,
          bytes.includes(0) ? "" : bytes.toString("utf8"),
        );
      }
    } catch {
      console.error(
        `${file}: cannot inspect file (stage deletions before checking)`,
      );
      failures++;
      continue;
    }
    for (const issue of issues) {
      console.error(`${file}: ${issue}`);
      failures++;
    }
  }
  if (failures) {
    console.error(
      `Publication check failed: ${failures} finding(s). No secret values were printed.`,
    );
    return 1;
  }
  console.log(
    `Publication check passed for ${files.length} Git candidate files. Review binary assets and personal content manually.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = checkPublication();
}
