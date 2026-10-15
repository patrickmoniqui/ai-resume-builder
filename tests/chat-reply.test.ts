import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import ChatReply from "../components/chat-reply";
import { normalizeChatReply } from "../lib/chat-format";

const render = (content: string) =>
  load(renderToStaticMarkup(createElement(ChatReply, { content })));

test("chat replies render Markdown structure, GFM tables, and code literally", () => {
  const $ = render(
    "## Resume advice\n\nUse **evidence** and *specifics*, not ~~guesses~~.\n\n- First\n  - Nested\n- Second\n\n1. Review\n2. Apply\n\n> Suggested wording\n\n`React`\n\n```html\n<script>alert('example')</script>\n```\n\n| Skill | Evidence |\n| --- | --- |\n| React | Project |\n\n- [x] Reviewed\n\n[Reference](https://example.com)",
  );
  assert.equal($("h2").text(), "Resume advice");
  assert.equal($("strong").text(), "evidence");
  assert.equal($("em").text(), "specifics");
  assert.equal($("del").text(), "guesses");
  assert.equal($("ul ul li").text(), "Nested");
  assert.equal($("ol li").length, 2);
  assert.equal($("blockquote").text().trim(), "Suggested wording");
  assert.equal(
    $("pre code").text().trim(),
    "<script>alert('example')</script>",
  );
  assert.equal($("script").length, 0);
  assert.equal($(".chat-table-scroll table th").length, 2);
  assert.equal($("table td").first().text(), "React");
  assert.equal($("input[type=checkbox][disabled][checked]").length, 1);
  assert.equal($("a").attr("href"), "https://example.com");
  assert.equal($("a").attr("rel"), "noopener noreferrer");
});

test("chat replies render basic HTML and mixed Markdown", () => {
  const $ = render(
    "<h3>Suggested summary</h3>\n<p>Built <strong>React</strong> apps with <em>care</em>.<br>Next line.</p>\n<ul><li>Documented result</li></ul>\n\n**Follow up**\n\n<table><tr><th>Skill</th></tr><tr><td>React</td></tr></table>",
  );
  assert.equal($("h3").text(), "Suggested summary");
  assert.equal($("strong").first().text(), "React");
  assert.equal($("strong").last().text(), "Follow up");
  assert.equal($("br").length, 1);
  assert.equal($("li").text(), "Documented result");
  assert.equal($(".chat-table-scroll td").text(), "React");
});

test("chat replies strip active HTML, event handlers, styles, and unsafe URLs", () => {
  const $ = render(
    '<script>alert(1)</script><iframe src="https://example.com"></iframe><style>body{display:none}</style>\n<p onclick="alert(1)" style="position:fixed">Safe text</p>\n<a href="javascript:alert(1)">Unsafe</a>\n<img src="https://example.com/tracker" onerror="alert(1)" alt="Image description">\n\n[Unsafe markdown](javascript:alert%281%29)',
  );
  assert.equal($("script, iframe, style, img").length, 0);
  assert.equal($("[onclick], [onerror], [style]").length, 0);
  assert.equal($("a[href]").length, 0);
  assert.ok($(".chat-reply").text().includes("Safe text"));
  assert.ok($(".chat-reply").text().includes("Image description"));
});

test("plain replies and escaped HTML remain readable", () => {
  const $ = render(
    "First paragraph.\n\nSecond paragraph with &lt;strong&gt;literal tags&lt;/strong&gt;.",
  );
  assert.equal($("p").length, 2);
  assert.equal($("strong").length, 0);
  assert.ok($("p").last().text().includes("<strong>literal tags</strong>"));
});

test("escaped paragraph breaks and nonbreaking heading spaces render as Markdown", () => {
  const $ = render(
    "Here is advice.\\n\\n###\u00a0Resume summary\\n\\nUse **facts**.\\n\\n- First step\\n- Second step",
  );
  assert.equal($("h3").text(), "Resume summary");
  assert.equal($("strong").text(), "facts");
  assert.equal($("ul li").length, 2);
  assert.equal($(".chat-reply").text().includes("\\n"), false);
  assert.equal($(".chat-reply").text().includes("###"), false);
  const inline = render("Intro\\n\\n### Heading\\nUse `React`\\nNext line.");
  assert.equal(inline("h3").text(), "Heading");
  assert.equal(inline("code").text(), "React");
  assert.equal(inline(".chat-reply").text().includes("\\n"), false);
});

test("real newlines and HTML nonbreaking spaces after Markdown markers are normalized", () => {
  for (const space of ["\u00a0", "\u202f", "&nbsp;", "&#160;", "&#xA0;"]) {
    const $ = render(
      `###${space}Heading\n\n-${space}Item\n\n1.${space}Ordered item`,
    );
    assert.equal($("h3").text(), "Heading");
    assert.equal($("ul li").text(), "Item");
    assert.equal($("ol li").text(), "Ordered item");
  }
  assert.equal(
    render("Intro\\r\\n\\r\\n###\u00a0Heading")("h3").text(),
    "Heading",
  );
});

test("format repair preserves literal escapes in inline, fenced, and indented code", () => {
  const literal = "\\n\\n###\u00a0literal";
  for (const code of [
    `\`${literal}\``,
    `\`\`\`text\n${literal}\n\`\`\``,
    `~~~text\n${literal}\n~~~`,
    `    ${literal}`,
    `<code>${literal}</code>`,
    `<pre><code>${literal}</code></pre>`,
  ]) {
    const source = `Intro\\n\\n###\u00a0Heading\n\n${code}\n\n**Done**.`;
    const $ = render(source);
    assert.equal($("h3").text(), "Heading");
    assert.equal($("code").text().trim(), literal);
    assert.equal(
      normalizeChatReply(normalizeChatReply(source)),
      normalizeChatReply(source),
    );
  }
  const path = "Open C:\\new\\notes.txt and describe the literal \\n escape.";
  assert.equal(normalizeChatReply(path), path);
});
