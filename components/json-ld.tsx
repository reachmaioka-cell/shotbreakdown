import type { Breakdown } from "@/lib/validation";

export function HowToJsonLd({
  name,
  description,
  image,
  steps,
  tools,
}: {
  name: string;
  description: string;
  image?: string | null;
  steps: string[];
  tools: string[];
}) {
  const json = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    description,
    image: image ?? undefined,
    step: steps.map((text, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      text,
    })),
    tool: tools.map((name) => ({ "@type": "HowToTool", name })),
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />
  );
}

export function ArticleJsonLd({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}) {
  const json = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    mainEntityOfPage: url,
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }} />
  );
}

export function breakdownTools(b: Breakdown): string[] {
  return [...b.budget_recreation.under_500_usd, ...b.budget_recreation.under_5000_usd].slice(0, 8);
}

/** Generic JSON-LD emitter for pages that build their own schema object. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
