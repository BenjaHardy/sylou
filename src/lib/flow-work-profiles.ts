export type FlowProfile = {
  code: string;
  name: string;
  tagline: string;
  description: string;
  pillarHighlights: {
    find: boolean;
    lead: boolean;
    organize: boolean;
    write: boolean;
  };
};

export const FLOW_PROFILES: FlowProfile[] = [
  {
    code: "FLOW",
    name: "The Architect",
    tagline: "You built this from the ground up.",
    description:
      "You drove the research, led with your own ideas, shaped the structure, and wrote the prose. The AI was there, but you were in charge at every stage. This is full-spectrum ownership of your work.",
    pillarHighlights: { find: true, lead: true, organize: true, write: true },
  },
  {
    code: "FLO-",
    name: "The Strategist",
    tagline: "You master the blueprint, and delegate the brushwork.",
    description:
      "You researched, thought deeply, and structured your argument yourself. When it came to writing the actual prose, you leaned on the AI, but the intellectual backbone is unmistakably yours.",
    pillarHighlights: { find: true, lead: true, organize: true, write: false },
  },
  {
    code: "FL-W",
    name: "The Essayist",
    tagline: "Your ideas, your words, with a little help organizing them.",
    description:
      "You did the thinking and the writing. The structure and argumentation leaned more on AI assistance, but the ideas and the voice are yours. Some of the best writing finds its structure along the way.",
    pillarHighlights: { find: true, lead: true, organize: false, write: true },
  },
  {
    code: "FL--",
    name: "The Visionary",
    tagline: "You brought the spark and let someone else fan the flames.",
    description:
      "Strong research and original ideas, but you handed off both structure and prose to the AI. You're the thinker in this collaboration, the one who knows what to say, if not always how to say it.",
    pillarHighlights: { find: true, lead: true, organize: false, write: false },
  },
  {
    code: "F-OW",
    name: "The Editor",
    tagline: "You shaped raw material into something structured and polished.",
    description:
      "You did serious research and built the architecture and prose yourself, but the core ideas and perspectives drew more heavily from AI. You're the one who took inputs and crafted them into a coherent piece.",
    pillarHighlights: { find: true, lead: false, organize: true, write: true },
  },
  {
    code: "F-O-",
    name: "The Analyst",
    tagline: "You dug deep and built the scaffolding.",
    description:
      "Your research and structural thinking carried the project, while ideas and final writing leaned more on AI. You're the methodical planner who ensures everything stands on solid ground.",
    pillarHighlights: { find: true, lead: false, organize: true, write: false },
  },
  {
    code: "F--W",
    name: "The Researcher-Writer",
    tagline: "You found the facts and found the words.",
    description:
      "Research and prose are your domain, the intellectual framing and structure came more from the AI. You're the kind of collaborator who knows what's true and knows how to say it well.",
    pillarHighlights: { find: true, lead: false, organize: false, write: true },
  },
  {
    code: "F---",
    name: "The Investigator",
    tagline: "You asked the hard questions.",
    description:
      "Your research and critical thinking stood out, but you relied on AI for ideas, structure, and writing. The intellectual curiosity is yours; the execution was a team effort.",
    pillarHighlights: { find: true, lead: false, organize: false, write: false },
  },
  {
    code: "-LOW",
    name: "The Auteur",
    tagline: "You had the vision, built the story, and wrote every line.",
    description:
      "Ideas, structure, prose: all predominantly yours. The one area where AI contributed more was research and fact-finding. You know what you want to say and how to say it; you just needed someone to help check the facts.",
    pillarHighlights: { find: false, lead: true, organize: true, write: true },
  },
  {
    code: "-LO-",
    name: "The Thinker",
    tagline: "You shaped the ideas and the argument, then let someone else write it up.",
    description:
      "Original ideas and strong structural thinking, but both the research and the final prose leaned on AI. You're the intellectual core of this project, even if you didn't do all the legwork or wordsmithing.",
    pillarHighlights: { find: false, lead: true, organize: true, write: false },
  },
  {
    code: "-L-W",
    name: "The Voice",
    tagline: "Your ideas, your words.",
    description:
      "Strong opinions and distinctive writing, but research and structure leaned on AI. You know what you think and you know how to express it, you just prefer to let someone else handle the organization and fact-checking.",
    pillarHighlights: { find: false, lead: true, organize: false, write: true },
  },
  {
    code: "-L--",
    name: "The Spark",
    tagline: "One big thing: the ideas were yours.",
    description:
      "Your core contribution was original thinking, the perspectives and opinions that define the work. Research, structure, and writing all relied more on the AI. Sometimes one strong spark is all a project needs.",
    pillarHighlights: { find: false, lead: true, organize: false, write: false },
  },
  {
    code: "--OW",
    name: "The Craftsperson",
    tagline: "You didn't start the conversation, but you built the house.",
    description:
      "Structure and writing were your domain, you organized the material and wrote it yourself. But the underlying research and ideas drew more from AI. You're the builder who turns raw material into a finished product.",
    pillarHighlights: { find: false, lead: false, organize: true, write: true },
  },
  {
    code: "--O-",
    name: "The Organizer",
    tagline: "You brought order to the chaos.",
    description:
      "Your main contribution was structural, shaping the argumentation and flow of the work. Research, ideas, and prose leaned more on AI. Every good project needs someone who can see the big picture and make things click into place.",
    pillarHighlights: { find: false, lead: false, organize: true, write: false },
  },
  {
    code: "---W",
    name: "The Scribe",
    tagline: "The words are yours, even if the ideas came from elsewhere.",
    description:
      "You wrote the prose yourself, but research, ideas, and structure relied more on AI. There's genuine craft in putting things into words: tone, rhythm, clarity. That part was all you.",
    pillarHighlights: { find: false, lead: false, organize: false, write: true },
  },
  {
    code: "----",
    name: "The Conductor",
    tagline: "You directed the orchestra without playing an instrument.",
    description:
      "The AI contributed heavily across all pillars, and your role was more curatorial: selecting, approving, and steering. That's a legitimate collaboration style, and in many contexts it's exactly the right approach. The baton matters.",
    pillarHighlights: { find: false, lead: false, organize: false, write: false },
  },
];

const profileMap = new Map<string, FlowProfile>(
  FLOW_PROFILES.map((p) => [p.code, p])
);

type PillarScores = {
  find: number | null;
  lead: number | null;
  organize: number | null;
  write: number | null;
};

export function getProfileCode(scores: PillarScores): string {
  return [
    (scores.find ?? 0) >= 3 ? "F" : "-",
    (scores.lead ?? 0) >= 3 ? "L" : "-",
    (scores.organize ?? 0) >= 3 ? "O" : "-",
    (scores.write ?? 0) >= 3 ? "W" : "-",
  ].join("");
}

export function getFlowProfile(scores: PillarScores): FlowProfile {
  const code = getProfileCode(scores);
  return profileMap.get(code)!;
}
