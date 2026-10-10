import React from "react";

function inline(text: string): React.ReactNode[] {
  const parts = text.split("**");
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>));
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm leading-6">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (trimmed.startsWith("## ")) return <h3 key={i} className="pt-2 text-base font-bold">{trimmed.slice(3)}</h3>;
        if (trimmed.startsWith("# ")) return <h2 key={i} className="text-lg font-bold">{trimmed.slice(2)}</h2>;
        const lines = trimmed.split("\n");
        if (lines.every((l) => l.trim().startsWith("- ") || l.trim() === "")) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.filter((l) => l.trim()).map((l, j) => <li key={j}>{inline(l.trim().slice(2))}</li>)}
            </ul>
          );
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l)}{j < lines.length - 1 ? <br /> : null}</span>)}</p>;
      })}
    </div>
  );
}
