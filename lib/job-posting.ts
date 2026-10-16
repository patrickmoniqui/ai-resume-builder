import * as cheerio from "cheerio";

const MIN_DESCRIPTION_LENGTH = 50;
export const jobLinkFallbackMessage =
  "This link did not expose a readable job description. The site may require JavaScript or sign-in. Open the posting, copy its responsibilities and requirements, and paste them below to scan with AI.";

export function extractJobPosting(html: string, address: string) {
  // A JSON redirect/bootstrap response is not a description. In particular,
  // its URL can look like enough text to pass the minimum-length check.
  if (/^\s*[\[{]/.test(html)) {
    try {
      JSON.parse(html);
      return {
        text: "",
        title: "",
        company: new URL(address).hostname,
        location: "",
      };
    } catch {
      // Non-JSON text can still contain a readable posting.
    }
  }
  const $ = cheerio.load(html);
  const postings: Record<string, unknown>[] = [];
  const search = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(search);
      return;
    }
    if (!node || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    if (
      object["@type"] === "JobPosting" ||
      (Array.isArray(object["@type"]) && object["@type"].includes("JobPosting"))
    )
      postings.push(object);
    if (object["@graph"]) search(object["@graph"]);
    if (object.mainEntity) search(object.mainEntity);
    if (object.itemListElement) search(object.itemListElement);
    if (object.item) search(object.item);
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      search(JSON.parse($(element).text()));
    } catch {}
  });
  // Zoho Recruit embeds the posting as JSON inside a JavaScript string.
  // Decode only that literal; never evaluate scripts from a remote page.
  $("script:not([src])").each((_, element) => {
    const match = $(element)
      .text()
      .match(
        /\b(?:var|let|const)\s+jobs\s*=\s*JSON\.parse\(\s*'((?:\\[\s\S]|[^'\\])*)'\s*\)/,
      );
    if (!match) return;
    try {
      const decoded = match[1].replace(
        /\\(x[0-9a-f]{2}|u[0-9a-f]{4}|[\s\S])/gi,
        (_, escape: string) => {
          if (escape.startsWith("x") && escape.length === 3)
            return String.fromCharCode(parseInt(escape.slice(1), 16));
          if (escape.startsWith("u") && escape.length === 5)
            return String.fromCharCode(parseInt(escape.slice(1), 16));
          const escapes: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            b: "\b",
            f: "\f",
            v: "\v",
            "0": "\0",
          };
          return escapes[escape] ?? escape;
        },
      );
      const jobs: unknown = JSON.parse(decoded);
      if (!Array.isArray(jobs)) return;
      for (const entry of jobs) {
        if (!entry || typeof entry !== "object") continue;
        const job = entry as Record<string, unknown>;
        if (typeof job.Job_Description !== "string") continue;
        postings.push({
          title: job.Posting_Title,
          description: job.Job_Description,
          hiringOrganization: {
            name:
              job.Client_Name ||
              job.Company ||
              $("meta[property='og:site_name']").attr("content"),
          },
          jobLocation: {
            address: { addressLocality: job.City, addressRegion: job.State },
          },
        });
      }
    } catch {
      /* Other site data or malformed JSON is not a job posting. */
    }
  });
  const plainText = (markup: string) => {
    const content = cheerio.load(markup);
    content("script,style,noscript,nav,footer").remove();
    content("br").replaceWith("\n");
    content("p,div,li,h1,h2,h3,h4,section").append("\n");
    return content("body")
      .text()
      .replace(/[\t ]+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim()
      .slice(0, 60000);
  };
  // Some sites provide JobPosting metadata without its description. Keep the
  // metadata, but fall back to the visible content instead of discarding it.
  const candidates = postings.map((posting) => ({
    posting,
    text: plainText(
      typeof posting.description === "string" ? posting.description : "",
    ),
  }));
  candidates.sort((a, b) => b.text.length - a.text.length);
  const candidate = candidates[0];
  const posting = candidate?.posting;
  $("script,style,noscript,nav,footer,header").remove();
  let text = candidate?.text || "";
  if (text.length < MIN_DESCRIPTION_LENGTH) {
    const main = plainText($("main").html() || "");
    text =
      main.length >= MIN_DESCRIPTION_LENGTH
        ? main
        : plainText($("body").html() || "");
  }
  const org = posting?.hiringOrganization as { name?: string } | undefined;
  const rawLocation = posting?.jobLocation;
  const loc = (Array.isArray(rawLocation) ? rawLocation[0] : rawLocation) as
    | { address?: { addressLocality?: string; addressRegion?: string } }
    | undefined;
  return {
    text,
    title:
      typeof posting?.title === "string"
        ? posting.title
        : $("h1").first().text().trim() || $("title").text().trim(),
    company:
      typeof org?.name === "string" ? org.name : new URL(address).hostname,
    location:
      [loc?.address?.addressLocality, loc?.address?.addressRegion]
        .filter(Boolean)
        .join(", ") ||
      (typeof posting?.jobLocationType === "string"
        ? posting.jobLocationType
        : ""),
  };
}
