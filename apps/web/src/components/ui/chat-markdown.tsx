import { renderMarkdown } from "@/lib/markdown";
import { memo, useMemo } from "react";

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
}: {
  content: string;
}) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className="chat-markdown leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-5 [&_a]:text-sky-500 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-sky-400 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-muted [&_blockquote]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#1e1e2e] [&_pre]:p-3 [&_pre]:text-[12px] [&_code]:font-mono [&_pre_code]:text-[#cdd6f4] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-surface-3 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.9em] [&_h1]:text-base [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-[14px] [&_h2]:font-bold [&_h2]:my-2 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:my-1.5 [&_hr]:my-3 [&_hr]:border-border"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it is configured with html:false, raw HTML is escaped
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
