/** Proactive curriculum: iconic music videos known for cinematography. Worker learns these independently of user submissions. */

export type MusicVideoCurriculumItem = {
  id: string;
  artist: string;
  title: string;
  youtubeUrl: string;
  cinematographer?: string;
  director?: string;
  tags: string[];
};

export const MUSIC_VIDEO_CURRICULUM: MusicVideoCurriculumItem[] = [
  {
    id: "gotye-kimbra",
    artist: "Gotye",
    title: "Somebody That I Used To Know",
    youtubeUrl: "https://www.youtube.com/watch?v=8UVNT4wvIGY",
    director: "Natasha Pincus",
    cinematographer: "N/A (body-paint tableau)",
    tags: ["music-video", "studio", "two-shot", "static"],
  },
  {
    id: "kendrick-humble",
    artist: "Kendrick Lamar",
    title: "HUMBLE.",
    youtubeUrl: "https://www.youtube.com/watch?v=tvTRZJ-4EyI",
    director: "Dave Meyers",
    cinematographer: "Scott Cunningham",
    tags: ["music-video", "lighting", "wide-angle"],
  },
  {
    id: "childish-gambino-america",
    artist: "Childish Gambino",
    title: "This Is America",
    youtubeUrl: "https://www.youtube.com/watch?v=VYOjWnS4cMY",
    director: "Hiro Murai",
    cinematographer: "Christian Sprenger",
    tags: ["music-video", "long-take", "handheld"],
  },
  {
    id: "beyonce-formation",
    artist: "Beyoncé",
    title: "Formation",
    youtubeUrl: "https://www.youtube.com/watch?v=WDZJPJV__bQ",
    director: "Melina Matsoukas",
    tags: ["music-video", "natural-light", "golden-hour"],
  },
  {
    id: "taylor-all-too-well",
    artist: "Taylor Swift",
    title: "All Too Well (10 Minute Version)",
    youtubeUrl: "https://www.youtube.com/watch?v=toll04Xi23Q",
    director: "Taylor Swift",
    cinematographer: "Rina Yang",
    tags: ["music-video", "narrative", "natural-light"],
  },
  {
    id: "weeknd-blinding-lights",
    artist: "The Weeknd",
    title: "Blinding Lights",
    youtubeUrl: "https://www.youtube.com/watch?v=4NRXx6U8ABQ",
    director: "Anton Tammi",
    cinematographer: "Nikita Rukha",
    tags: ["music-video", "neon", "night-exterior"],
  },
  {
    id: "sia-chandelier",
    artist: "Sia",
    title: "Chandelier",
    youtubeUrl: "https://www.youtube.com/watch?v=2vjPBrBU-TM",
    director: "Daniel Askill",
    cinematographer: "Sebastian Winterø",
    tags: ["music-video", "single-location", "wide-angle"],
  },
  {
    id: "harry-as-it-was",
    artist: "Harry Styles",
    title: "As It Was",
    youtubeUrl: "https://www.youtube.com/watch?v=qZ70feW1mM4",
    director: "Us",
    tags: ["music-video", "one-shot", "rotation"],
  },
  {
    id: "billie-bad-guy",
    artist: "Billie Eilish",
    title: "bad guy",
    youtubeUrl: "https://www.youtube.com/watch?v=DyDfgMOUjCI",
    director: "Dave Meyers",
    tags: ["music-video", "studio", "color-grade"],
  },
  {
    id: "kanye-runaway",
    artist: "Kanye West",
    title: "Runaway",
    youtubeUrl: "https://www.youtube.com/watch?v=Bm5iA4ZVUsk",
    director: "Kanye West",
    cinematographer: "Hoyte van Hoytema",
    tags: ["music-video", "anamorphic", "ballet"],
  },
  {
    id: "jayz-99-problems",
    artist: "Jay-Z",
    title: "99 Problems",
    youtubeUrl: "https://www.youtube.com/watch?v=WwoM5fLITfk",
    director: "Mark Romanek",
    cinematographer: "Harris Savides",
    tags: ["music-video", "black-and-white", "handheld"],
  },
  {
    id: "ok-go-here-it-goes",
    artist: "OK Go",
    title: "Here It Goes Again",
    youtubeUrl: "https://www.youtube.com/watch?v=dTAAsCNK7RA",
    tags: ["music-video", "practical", "single-take"],
  },
  {
    id: "massive-attack-teardrop",
    artist: "Massive Attack",
    title: "Teardrop",
    youtubeUrl: "https://www.youtube.com/watch?v=6SWmK9m0yQc",
    director: "Walter Stern",
    tags: ["music-video", "macro", "slow-motion"],
  },
  {
    id: "radiohead-no-surprises",
    artist: "Radiohead",
    title: "No Surprises",
    youtubeUrl: "https://www.youtube.com/watch?v=u5CVsCnxyXg",
    director: "Grant Lee",
    tags: ["music-video", "single-shot", "underwater"],
  },
  {
    id: "frank-ocean-nike",
    artist: "Frank Ocean",
    title: "Nikes",
    youtubeUrl: "https://www.youtube.com/watch?v=2gjsuT_WLII",
    director: "Tyrone Lebon",
    tags: ["music-video", "visual-effects", "color-grade"],
  },
  {
    id: "rosalia-malamente",
    artist: "Rosalía",
    title: "Malamente",
    youtubeUrl: "https://www.youtube.com/watch?v=Rht7rBHXjxI",
    director: "CANADA",
    tags: ["music-video", "flamenco", "slow-motion"],
  },
  {
    id: "dua-levitating",
    artist: "Dua Lipa",
    title: "Levitating",
    youtubeUrl: "https://www.youtube.com/watch?v=TUVcZfQe-Kw",
    tags: ["music-video", "disco", "studio"],
  },
  {
    id: "dua-houdini",
    artist: "Dua Lipa",
    title: "Houdini",
    youtubeUrl: "https://www.youtube.com/watch?v=suAR1PYTZEI",
    director: "Tanu Muino",
    tags: ["music-video", "one-shot", "dolly"],
  },
  {
    id: "tyler-see-you-again",
    artist: "Tyler, The Creator",
    title: "See You Again",
    youtubeUrl: "https://www.youtube.com/watch?v=KNxDFOA899Q",
    director: "Wolf Haley",
    tags: ["music-video", "pastel", "dreamlike"],
  },
  {
    id: "arctic-do-i-wanna-know",
    artist: "Arctic Monkeys",
    title: "Do I Wanna Know?",
    youtubeUrl: "https://www.youtube.com/watch?v=bpOSxM0rNPM",
    director: "N/A",
    tags: ["music-video", "animation", "minimal"],
  },
];

export function musicVideoLabel(item: MusicVideoCurriculumItem) {
  return `${item.artist} - ${item.title}`;
}

export function musicVideoSearchQueries(item: MusicVideoCurriculumItem): string[] {
  const label = musicVideoLabel(item);
  const queries = [
    `${label} music video cinematography breakdown`,
    `${label} music video behind the scenes lighting camera`,
    `${label} director of photography interview`,
    `${label} music video VFX editing color grade`,
  ];
  if (item.cinematographer) {
    queries.push(`${item.cinematographer} ${item.title} cinematography`);
  }
  if (item.director) {
    queries.push(`${item.director} ${item.title} music video director interview`);
  }
  return queries;
}
