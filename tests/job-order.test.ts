import test from "node:test";
import assert from "node:assert/strict";
import { moveJob, type Job } from "../lib/model";

const job = (id: string): Job => ({
  id,
  templateId: "t",
  source: "Manual",
  title: id,
  company: "Co",
  location: "",
  rawDescription: "",
  keywords: [],
});
const ids = (jobs: Job[]) => jobs.map((j) => j.id).join("");

test("moveJob reorders and clamps", () => {
  const jobs = ["a", "b", "c", "d"].map(job);
  assert.equal(ids(moveJob(jobs, "a", 2)), "bcad");
  assert.equal(ids(moveJob(jobs, "d", 0)), "dabc");
  assert.equal(ids(moveJob(jobs, "b", -5)), "bacd");
  assert.equal(ids(moveJob(jobs, "b", 99)), "acdb");
  assert.equal(moveJob(jobs, "c", 2), jobs);
  assert.equal(moveJob(jobs, "missing", 0), jobs);
  assert.equal(ids(jobs), "abcd");
});
