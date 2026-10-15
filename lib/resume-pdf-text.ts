import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const headingLabels: Record<string, string> = {
  ResumeCompany: "Company: ",
  ResumeTeam: "Team: ",
  ResumeRole: "Role: ",
};

/** Recover exported experience boundaries from semantic tags, not visible labels. */
export async function taggedResumeText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const lines: string[] = [];
    let tagged = false;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent({ includeMarkedContent: true });
      let line = "";
      let lastY: number | undefined;
      let heading: { label: string; parts: string[] } | undefined;
      const flush = () => {
        if (line.trim()) lines.push(line.trim());
        line = "";
        lastY = undefined;
      };
      for (const item of content.items) {
        if (!("str" in item)) {
          const tag =
            "tag" in item && typeof item.tag === "string" ? item.tag : "";
          if (item.type === "beginMarkedContent" && headingLabels[tag]) {
            flush();
            tagged = true;
            heading = { label: headingLabels[tag], parts: [] };
          } else if (item.type === "endMarkedContent" && heading) {
            // A heading can wrap; keep it as one logical parser line.
            lines.push(heading.label + heading.parts.join(" "));
            heading = undefined;
          }
          continue;
        }
        if (heading) {
          if (item.str.trim()) heading.parts.push(item.str.trim());
          continue;
        }
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(lastY - y) > 4.6) flush();
        line += item.str;
        lastY = y;
        if (item.hasEOL) flush();
      }
      flush();
      page.cleanup();
    }
    return tagged ? lines.join("\n") : undefined;
  } finally {
    await task.destroy();
  }
}
