import { createElement, type ReactNode } from "react";

export function renderMarkdown(md: string): ReactNode {
  const blocks = md.trim().split(/\n{2,}/);
  return blocks.map((block, i) => {
    const line = block.trim();
    if (line.startsWith("### ")) {
      return createElement("h3", { key: i, className: "text-white text-base font-medium mt-8 mb-2" }, line.slice(4));
    }
    if (line.startsWith("## ")) {
      return createElement("h2", { key: i, className: "text-white text-lg font-semibold mt-10 mb-3" }, line.slice(3));
    }
    if (line.startsWith("# ")) {
      return createElement("h1", { key: i, className: "text-white text-lg font-medium mb-4" }, line.slice(2));
    }
    if (line.startsWith("- ")) {
      const items = line.split("\n").map((l) => l.replace(/^- /, ""));
      return createElement(
        "ul",
        { key: i, className: "list-disc pl-5 text-zinc-300 text-sm space-y-1 my-3" },
        items.map((item, j) => createElement("li", { key: j }, inline(item)))
      );
    }
    return createElement("p", { key: i, className: "text-zinc-300 text-sm leading-relaxed my-3" }, inline(line));
  });
}

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return createElement("strong", { key: i, className: "text-white font-medium" }, part.slice(2, -2));
    }
    return part;
  });
}
