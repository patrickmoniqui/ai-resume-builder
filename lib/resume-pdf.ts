import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  rgb,
  type Color,
  type PDFFont,
} from "pdf-lib";
import {
  groupExperience,
  hasRoleContent,
  pruneBlankRoles,
  resumeSections,
  skillLabel,
  type Resume,
} from "./model";
import { dateRange } from "./parsing";
type FontName = "regular" | "bold" | "boldItalic";
type Row = {
  text: string;
  font: FontName;
  size: number;
  height: number;
  before: number;
  indent: number;
  keepWithNext: boolean;
  color: Color;
  divider?: boolean;
  // Bold prefix drawn before the first line, e.g. a "Label:" in skills.
  lead?: string;
  rightText?: string;
  tag?: string;
  tagId?: number;
};
const INK = rgb(0.1, 0.1, 0.1),
  ACCENT = rgb(0.122, 0.306, 0.475),
  MUTED = rgb(0.35, 0.35, 0.35),
  RULE = rgb(0.65, 0.65, 0.65);
const PAGE_WIDTH = 612,
  PAGE_HEIGHT = 792,
  MARGIN = 48,
  TOP = 738,
  BOTTOM = 60,
  WIDTH = 516;
const clean = (text: string) =>
  text
    .replace(/\u2011/g, "-")
    .replace(/\u202f/g, " ")
    .replace(
      /[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\n]/g,
      "",
    );
function trailingDates(text: string, allowYear = false) {
  const trimmed = text.trim();
  const match =
    trimmed.match(dateRange) ||
    (allowYear ? trimmed.match(/\b(?:19|20)\d{2}$/) : null);
  if (!match || match.index! + match[0].length !== trimmed.length)
    return { text, dates: "" };
  return {
    text: trimmed.slice(0, match.index).replace(/[\s·|–—-]+$/, ""),
    dates: match[0],
  };
}
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
  firstWidth = width,
) {
  const rows: string[] = [];
  const limit = () => (rows.length ? width : firstWidth);
  for (const paragraph of clean(text).split("\n")) {
    let line = "";
    for (let word of paragraph.trim().split(/\s+/)) {
      if (!word) continue;
      if (line && font.widthOfTextAtSize(line + " " + word, size) > limit()) {
        rows.push(line);
        line = "";
      }
      while (font.widthOfTextAtSize(word, size) > limit()) {
        let length = 1;
        while (
          length < word.length &&
          font.widthOfTextAtSize(word.slice(0, length + 1), size) <= limit()
        )
          length++;
        rows.push(word.slice(0, length));
        word = word.slice(length);
      }
      line = line ? line + " " + word : word;
    }
    if (line) rows.push(line);
  }
  return rows;
}
function layoutRows(
  doc: Resume,
  fonts: Record<FontName, PDFFont>,
  scale: number,
  pageCount: 1 | 2,
) {
  const rows: Row[] = [];
  const add = (
    text: string,
    size = 10,
    font: FontName = "regular",
    indent = 0,
    before = 0,
    keepWithNext = false,
    divider = false,
    rightText = "",
    tag?: string,
    color = INK,
    lead = "",
  ) => {
    const availableWidth = WIDTH - indent;
    const dateWidth = Math.min(
      fonts.regular.widthOfTextAtSize(clean(rightText), size * scale),
      availableWidth / 2,
    );
    const textWidth = rightText
      ? availableWidth - dateWidth - 16 * scale
      : availableWidth;
    const leadText = clean(lead);
    const leftLines = wrap(
      text,
      fonts[font],
      size * scale,
      textWidth,
      textWidth - fonts.bold.widthOfTextAtSize(leadText, size * scale),
    );
    const rightLines = rightText
      ? wrap(rightText, fonts.regular, size * scale, dateWidth)
      : [];
    const lines = Array.from(
      {
        length: Math.max(leftLines.length, rightLines.length, leadText ? 1 : 0),
      },
      (_, i) => leftLines[i] || "",
    );
    const tagId = rows.length;
    lines.forEach((line, i) =>
      rows.push({
        text: line,
        font,
        size: size * scale,
        height:
          size * scale * (divider ? 1.35 : 1.3) + (divider ? 6 * scale : 0),
        before: i === 0 ? before * scale : 0,
        indent,
        keepWithNext: keepWithNext || i < lines.length - 1,
        color,
        divider: divider && i === lines.length - 1,
        lead: i === 0 && leadText ? leadText : undefined,
        rightText: rightLines[i],
        tag,
        tagId,
      }),
    );
  };
  const section = (title: string) =>
    add(
      title.toUpperCase(),
      10,
      "bold",
      0,
      pageCount === 1 ? 14 : 20,
      true,
      true,
      "",
      undefined,
      ACCENT,
    );
  add(doc.name, 22, "bold", 0, 0, true, false, "", undefined, ACCENT);
  add(doc.headline, 13, "regular", 0, 2, true, false, "", undefined, MUTED);
  add(doc.contact, 8.5, "regular", 0, 1, true, false, "", undefined, MUTED);
  for (const { id } of resumeSections(doc)) {
    if (id === "summary" && doc.summary) {
      section("Summary");
      add(doc.summary, 10, "regular", 0, 7);
    }
    const roles = pruneBlankRoles(doc).doc.roles;
    if (id === "experience" && roles.length) {
      section("Experience");
      groupExperience(roles).forEach((company, ci) => {
        if (company.company.trim())
          add(
            company.company,
            10.5,
            "bold",
            0,
            ci === 0 ? 7 : 12,
            true,
            false,
            "",
            "ResumeCompany",
          );
        // A company may have no roles; its placeholder entry prints nothing.
        for (const { role } of company.roles) {
          if (!hasRoleContent(role)) continue;
          // Roles align with the company; bullets are indented slightly.
          add(
            role.title,
            10,
            "boldItalic",
            0,
            4,
            role.bullets.some((b) => b.trim()),
            false,
            role.dates.trim(),
            "ResumeRole",
            ACCENT,
          );
          for (const bullet of role.bullets)
            if (bullet.trim()) add("• " + bullet, 10, "regular", 10);
        }
      });
    }
    if (id === "skills" && doc.skills) {
      section("Skills");
      doc.skills
        .split("\n")
        .filter((line) => line.trim())
        .forEach((line, i) => {
          const entry = skillLabel(line.trim());
          add(
            entry.text,
            10,
            "regular",
            0,
            i === 0 ? 7 : 2,
            false,
            false,
            "",
            undefined,
            INK,
            entry.lead,
          );
        });
    }
    if (id === "education" && doc.edu.length) {
      section("Education");
      doc.edu.forEach((e, i) => {
        const heading = [e.degree, e.school].filter(Boolean).join(" · ");
        const entry = e.dates.trim()
          ? { text: heading, dates: e.dates.trim() }
          : trailingDates(heading, true);
        add(
          entry.text,
          10,
          "regular",
          0,
          i === 0 ? 7 : 5,
          false,
          false,
          entry.dates,
        );
      });
    }
    if (id.startsWith("extra-")) {
      const extra = doc.extraSections?.[Number(id.slice(6))];
      if (extra?.text.trim()) {
        section(extra.title);
        extra.text.split("\n").forEach((line, i) => {
          const entry =
            line.length < 200 && !/^[\s•▪●-]/.test(line)
              ? trailingDates(line)
              : { text: line, dates: "" };
          // Dated lines are entry headings: bold the name before " — ".
          const split = entry.dates ? entry.text.indexOf(" — ") : -1;
          add(
            split < 0 ? entry.text : entry.text.slice(split + 3),
            10,
            entry.dates && split < 0 ? "bold" : "regular",
            /^\s*[•▪●]/.test(line) ? 10 : 0,
            i === 0 ? 7 : entry.dates ? 6 : 0,
            false,
            false,
            entry.dates,
            undefined,
            INK,
            split < 0 ? "" : entry.text.slice(0, split + 3),
          );
        });
      }
    }
  }
  return rows;
}
function height(rows: Row[]) {
  return rows.reduce((total, row) => total + row.height + row.before, 0);
}
function partition(rows: Row[], count: 1 | 2): Row[][] {
  if (count === 1) return [rows];
  let best = 1,
    score = Infinity;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].keepWithNext) continue;
    const cost = Math.max(height(rows.slice(0, i)), height(rows.slice(i)));
    if (cost < score) {
      score = cost;
      best = i;
    }
  }
  // Tiny documents can have fewer than two meaningful blocks; preserve the chosen page count.
  return [rows.slice(0, best), rows.slice(best)];
}
export async function buildResumePDF(doc: Resume) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const count = doc.pageCount || 1;
  let pages: Row[][] = [];
  for (let step = 100; step >= 73; step--) {
    pages = partition(layoutRows(doc, fonts, step / 100, count), count);
    if (pages.every((rows) => height(rows) <= TOP - BOTTOM)) break;
    if (step === 73)
      throw new Error(
        `This resume is too long for ${count === 1 ? "a single page" : "two pages"} at a readable size. ${count === 1 ? "Choose Dual page or shorten the content." : "Shorten the content before exporting."}`,
      );
  }
  pages.forEach((rows, index) => {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = TOP;
    for (const [rowIndex, row] of rows.entries()) {
      y -= row.before;
      // Semantic tags preserve company/team/role boundaries for re-import
      // without adding labels to the visible resume.
      if (row.tag && rows[rowIndex - 1]?.tagId !== row.tagId)
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [
            PDFName.of(row.tag),
          ]),
        );
      let x = MARGIN + row.indent;
      if (row.lead) {
        page.drawText(row.lead, {
          x,
          y,
          size: row.size,
          font: fonts.bold,
          color: row.color,
        });
        x += fonts.bold.widthOfTextAtSize(row.lead, row.size);
      }
      page.drawText(row.text, {
        x,
        y,
        size: row.size,
        font: fonts[row.font],
        color: row.color,
      });
      if (row.rightText)
        page.drawText(row.rightText, {
          x:
            PAGE_WIDTH -
            MARGIN -
            fonts.regular.widthOfTextAtSize(row.rightText, row.size),
          y,
          size: row.size,
          font: fonts.regular,
          color: MUTED,
        });
      if (row.tag && rows[rowIndex + 1]?.tagId !== row.tagId)
        page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
      if (row.divider)
        page.drawLine({
          start: { x: MARGIN, y: y - row.size * 0.9 },
          end: { x: PAGE_WIDTH - MARGIN, y: y - row.size * 0.9 },
          thickness: 0.75,
          color: RULE,
        });
      y -= row.height;
    }
    if (count === 2)
      page.drawText(`${index + 1} / ${count}`, {
        x: PAGE_WIDTH - MARGIN - 20,
        y: 28,
        size: 8,
        font: fonts.regular,
        color: MUTED,
      });
  });
  return pdf.save({ useObjectStreams: false });
}
