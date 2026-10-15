import test from "node:test";
import assert from "node:assert/strict";
import { extractJobPosting } from "../lib/job-posting";
const description =
  "Build Python applications and generative AI agents. Required: Python and LLM experience. Preferred: FastAPI and Azure.";
const url = "https://jobs.example.com/job/123";

test("Zoho encoded job data is read without executing the page scripts", () => {
  const jobs = [
    {
      Posting_Title: "Développeur IA",
      Job_Description: `<p>${description}</p><p>Work with the team's engineers.</p>`,
      City: "Montréal",
      State: "Québec",
    },
  ];
  const literal = JSON.stringify(jobs)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "\\x22");
  const html = `<meta property="og:site_name" content="Blitz TI"><script>throw new Error('Do not execute'); var jobs = JSON.parse('${literal}');</script>`;
  const result = extractJobPosting(html, url);
  assert.equal(result.title, "Développeur IA");
  assert.equal(result.company, "Blitz TI");
  assert.equal(result.location, "Montréal, Québec");
  assert.ok(result.text.includes(description));
  assert.ok(result.text.includes("team's engineers"));
  assert.ok(!result.text.includes("Do not execute"));
});

test("incomplete JobPosting metadata falls back to visible description", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Engineer", description: "", hiringOrganization: { name: "Real Company" } })}</script><main><p>${description}</p></main>`;
  const result = extractJobPosting(html, url);
  assert.equal(result.title, "Engineer");
  assert.equal(result.company, "Real Company");
  assert.equal(result.text, description);
});

test("a short main element does not hide a full body description", () => {
  const result = extractJobPosting(
    `<main>Loading</main><section><p>${description}</p></section>`,
    url,
  );
  assert.ok(result.text.includes(description));
});

test("graph postings preserve block separation and use the complete description", () => {
  const result = extractJobPosting(
    `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "JobPosting", title: "Incomplete" },
        {
          "@type": "JobPosting",
          title: "Engineer",
          description: `<p>${description}</p><ul><li>Communicate clearly.</li></ul>`,
        },
      ],
    })}</script>`,
    url,
  );
  assert.equal(result.title, "Engineer");
  assert.ok(result.text.includes("\nCommunicate clearly."));
});
