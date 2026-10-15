/** Repair serialized paragraph breaks and heading spaces outside Markdown code. */
export function normalizeChatReply(content: string): string {
  const format = (text: string, escapedBreaks: boolean) => {
    if (escapedBreaks) {
      text = text.replace(/\\r\\n|\\n/g, "\n");
    }
    return text.replace(
      /^([ \t]{0,3}(?:#{1,6}|[-*+]|\d+[.)]))(?:\u00a0|\u202f|&nbsp;|&#160;|&#x[aA]0;)+/gm,
      "$1 ",
    );
  };
  const segments: { text: string; code: boolean }[] = [];
  let start = 0;
  const markers =
    /<pre\b[^>]*>[\s\S]*?(?:<\/pre\s*>|$)|<code\b[^>]*>[\s\S]*?(?:<\/code\s*>|$)|`+|~{3,}|^(?: {4}|\t)[^\n]*(?:\n(?:(?: {4}|\t)[^\n]*|[ \t]*(?=\n|$)))*/gim;
  let marker: RegExpExecArray | null;
  while ((marker = markers.exec(content))) {
    const run = marker[0];
    const from = marker.index;
    if (run[0] === " " || run[0] === "\t" || run[0] === "<") {
      segments.push(
        { text: content.slice(start, from), code: false },
        { text: run, code: true },
      );
      start = markers.lastIndex;
      continue;
    }
    const lineStart = content.lastIndexOf("\n", from - 1) + 1;
    const fence =
      run.length >= 3 && /^[ \t]{0,3}$/.test(content.slice(lineStart, from));
    let end = -1;
    if (fence) {
      const openingEnd = content.indexOf("\n", from + run.length);
      if (openingEnd < 0) continue;
      const closing = new RegExp(
        `^[ \\t]{0,3}${run[0]}{${run.length},}[ \\t]*(?:\\r?\\n|$)`,
        "gm",
      );
      closing.lastIndex = openingEnd + 1;
      const match = closing.exec(content);
      end = match ? match.index + match[0].length : content.length;
    } else if (run[0] === "`") {
      const closing = /`+/g;
      closing.lastIndex = from + run.length;
      let match: RegExpExecArray | null;
      while ((match = closing.exec(content))) {
        if (match[0].length === run.length) {
          end = match.index + match[0].length;
          break;
        }
      }
    }
    if (end < 0) continue;
    segments.push(
      { text: content.slice(start, from), code: false },
      { text: content.slice(from, end), code: true },
    );
    start = end;
    markers.lastIndex = end;
  }
  segments.push({ text: content.slice(start), code: false });
  // Paragraph separators or Markdown boundaries outside code indicate double escaping.
  // Isolated literal escapes, including those in code examples, stay untouched.
  const escapedBreaks = segments.some(
    ({ text, code }) =>
      !code &&
      /(?:\\r\\n|\\n){2}|(?:\\r\\n|\\n)(?=#{1,6}[ \t\u00a0\u202f]|[-*+] |\d+[.)] )/.test(
        text,
      ),
  );
  return segments
    .map(({ text, code }) => (code ? text : format(text, escapedBreaks)))
    .join("");
}
