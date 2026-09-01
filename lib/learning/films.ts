/** Proactive curriculum: iconic film trailers and sequences known for cinematography. */

export type FilmCurriculumItem = {
  id: string;
  title: string;
  youtubeUrl: string;
  cinematographer?: string;
  director?: string;
  tags: string[];
};

export const FILM_CURRICULUM: FilmCurriculumItem[] = [
  {
    id: "blade-runner-2049",
    title: "Blade Runner 2049",
    youtubeUrl: "https://www.youtube.com/watch?v=gCcxswz3MlA",
    cinematographer: "Roger Deakins",
    director: "Denis Villeneuve",
    tags: ["sci-fi", "neon", "Roger-Deakins"],
  },
  {
    id: "dune-2021",
    title: "Dune (2021)",
    youtubeUrl: "https://www.youtube.com/watch?v=8g18jFoaf0Y",
    cinematographer: "Greig Fraser",
    director: "Denis Villeneuve",
    tags: ["desert", "natural-light", "Greig-Fraser"],
  },
  {
    id: "interstellar",
    title: "Interstellar",
    youtubeUrl: "https://www.youtube.com/watch?v=zSWdZVtXT7E",
    cinematographer: "Hoyte van Hoytema",
    director: "Christopher Nolan",
    tags: ["IMAX", "practical", "space"],
  },
  {
    id: "moonlight",
    title: "Moonlight",
    youtubeUrl: "https://www.youtube.com/watch?v=9NJj12tJzqc",
    cinematographer: "James Laxton",
    director: "Barry Jenkins",
    tags: ["natural-light", "intimate", "color-grade"],
  },
  {
    id: "drive",
    title: "Drive",
    youtubeUrl: "https://www.youtube.com/watch?v=KBiOF3y1W0Y",
    cinematographer: "Newton Thomas Sigel",
    director: "Nicolas Winding Refn",
    tags: ["neon", "night", "anamorphic"],
  },
  {
    id: "sicario",
    title: "Sicario",
    youtubeUrl: "https://www.youtube.com/watch?v=ytY5oBgAACA",
    cinematographer: "Roger Deakins",
    director: "Denis Villeneuve",
    tags: ["silhouette", "desert", "Roger-Deakins"],
  },
  {
    id: "social-network",
    title: "The Social Network",
    youtubeUrl: "https://www.youtube.com/watch?v=lB95KLmplr4",
    cinematographer: "Jeff Cronenweth",
    director: "David Fincher",
    tags: ["studio", "low-key", "Fincher"],
  },
  {
    id: "her",
    title: "Her",
    youtubeUrl: "https://www.youtube.com/watch?v=WzV6mXIOpLI",
    cinematographer: "Hoyte van Hoytema",
    tags: ["soft-light", "pastel", "future"],
  },
  {
    id: "tree-of-life",
    title: "The Tree of Life",
    youtubeUrl: "https://www.youtube.com/watch?v=7ElnfuJs5uw",
    cinematographer: "Emmanuel Lubezki",
    director: "Terence Malick",
    tags: ["natural-light", "wide-angle", "poetic"],
  },
  {
    id: "no-country",
    title: "No Country for Old Men",
    youtubeUrl: "https://www.youtube.com/watch?v=38A__WT3-o0",
    cinematographer: "Roger Deakins",
    director: "Coen Brothers",
    tags: ["western", "natural-light", "static"],
  },
  {
    id: "revenant",
    title: "The Revenant",
    youtubeUrl: "https://www.youtube.com/watch?v=LoebZZ8K5N0",
    cinematographer: "Emmanuel Lubezki",
    director: "Alejandro González Iñárritu",
    tags: ["natural-light", "handheld", "wide-angle"],
  },
  {
    id: "arrival",
    title: "Arrival",
    youtubeUrl: "https://www.youtube.com/watch?v=tFMo3UJ4B4g",
    cinematographer: "Bradford Young",
    director: "Denis Villeneuve",
    tags: ["diffusion", "sci-fi", "minimal"],
  },
  {
    id: "1917",
    title: "1917",
    youtubeUrl: "https://www.youtube.com/watch?v=YqNYrYUiMfg",
    cinematographer: "Roger Deakins",
    director: "Sam Mendes",
    tags: ["one-shot", "war", "Roger-Deakins"],
  },
  {
    id: "mandy",
    title: "Mandy",
    youtubeUrl: "https://www.youtube.com/watch?v=wrH6vr0EaWo",
    cinematographer: "Benjamin Loeb",
    tags: ["neon", "horror", "color-grade"],
  },
  {
    id: "everything-everywhere",
    title: "Everything Everywhere All at Once",
    youtubeUrl: "https://www.youtube.com/watch?v=w0FEYt7MfwQ",
    cinematographer: "Lark Spies",
    director: "Daniels",
    tags: ["practical", "wide-angle", "VFX"],
  },
];

export function filmLabel(item: FilmCurriculumItem) {
  return item.title;
}

export function filmSearchQueries(item: FilmCurriculumItem): string[] {
  const queries = [
    `${item.title} cinematography breakdown behind the scenes`,
    `${item.title} lighting camera lens interview`,
    `${item.title} VFX color grading editing`,
  ];
  if (item.cinematographer) {
    queries.push(`${item.cinematographer} ${item.title} cinematography interview`);
    queries.push(`${item.cinematographer} lighting techniques`);
  }
  if (item.director) {
    queries.push(`${item.director} ${item.title} visual style`);
  }
  return queries;
}
