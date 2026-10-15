import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { normalizeChatReply } from "@/lib/chat-format";

export default function ChatReply({ content }: { content: string }) {
  return (
    <div className="chat-reply">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ children, href, title }) => (
            <a
              href={href}
              title={title}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div
              className="chat-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Reply table"
            >
              <table>{children}</table>
            </div>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {normalizeChatReply(content)}
      </Markdown>
    </div>
  );
}
