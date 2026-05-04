import flowArchitect from "@/assets/flow-profiles/flow-architect.jpg";
import floStrategist from "@/assets/flow-profiles/flo-strategist.jpeg";
import flwEssayist from "@/assets/flow-profiles/fl-w-essayist.jpg";
import flVisionary from "@/assets/flow-profiles/fl-visionary.jpg";
import fowEditor from "@/assets/flow-profiles/f-ow-editor.jpg";
import foAnalyst from "@/assets/flow-profiles/f-o-analyst.jpg";
import fwResearcherWriter from "@/assets/flow-profiles/f-w-researcher-writer.jpg";
import fInvestigator from "@/assets/flow-profiles/f-investigator.jpg";
import lowAuteur from "@/assets/flow-profiles/low-auteur.jpg";
import loThinker from "@/assets/flow-profiles/lo-thinker.png";
import lwVoice from "@/assets/flow-profiles/l-w-voice.jpg";
import lSpark from "@/assets/flow-profiles/l-spark.webp";
import owCraftsperson from "@/assets/flow-profiles/ow-craftsperson.jpg";
import oOrganizer from "@/assets/flow-profiles/o-organizer.png";
import wScribe from "@/assets/flow-profiles/w-scribe.jpg";
import conductor from "@/assets/flow-profiles/conductor.jpg";

export type ProfilePainting = {
  image: string;
  title: string;
  artist: string;
  year: string;
  sourceUrl: string;
  rationale: string;
};

export const PROFILE_PAINTINGS: Record<string, ProfilePainting> = {
  FLOW: {
    image: flowArchitect,
    title: "Vitruvian Man",
    artist: "Leonardo da Vinci",
    year: "c. 1490",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Da_Vinci_Vitruve_Luc_Viatour.jpg",
    rationale:
      "A figure of perfect proportion at the centre of every framework: anatomy, geometry, art and science. The Architect, like the Vitruvian Man, represents every dimension of the work.",
  },
  "FLO-": {
    image: floStrategist,
    title: "The Chess Players",
    artist: "Thomas Eakins",
    year: "1876",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:The_chess_players_thomas_eakins.jpeg",
    rationale:
      "Two minds bent over a board where the next move has already been calculated. Strategy precedes execution; the brushwork is delegated to the hand, but the plan is sovereign.",
  },
  "FL-W": {
    image: flwEssayist,
    title: "The Reader (La Liseuse)",
    artist: "Jean-Honoré Fragonard",
    year: "c. 1770–72",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Fragonard,_The_Reader.jpg",
    rationale:
      "A solitary reader absorbed in her book, voice and thought intertwined. The Essayist writes as they think, ideas and prose flowing from the same personal source.",
  },
  "FL--": {
    image: flVisionary,
    title: "Wanderer above the Sea of Fog",
    artist: "Caspar David Friedrich",
    year: "1818",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg",
    rationale:
      "The defining Romantic image of vision and inspiration. The figure stands above the world, gazing into the unknown. He has the perspective and the spark; what to do with it is for others to handle.",
  },
  "F-OW": {
    image: fowEditor,
    title: "Woman Holding a Balance",
    artist: "Johannes Vermeer",
    year: "c. 1664",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Woman_Holding_a_Balance_(Vermeer).jpg",
    rationale:
      "The figure weighs, judges, and refines. She did not invent the materials before her but she is the one bringing them into careful balance. Quiet authority over the work of selection and refinement.",
  },
  "F-O-": {
    image: foAnalyst,
    title: "The Geographer",
    artist: "Johannes Vermeer",
    year: "1669",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Johannes_Vermeer_-_The_Geographer_-_WGA24687.jpg",
    rationale:
      "A scholar at his desk, compass in hand, methodically engaging with a map, his notes spread around him. Pure research and structure made visible.",
  },
  "F--W": {
    image: fwResearcherWriter,
    title: "Camille au métier (Camille at the Loom)",
    artist: "Claude Monet",
    year: "1875",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Camille_au_m%C3%A9tier_(1875)_Claude_Monet_-_The_Barnes_Foundation,_Philadelphia_(W366).jpg",
    rationale:
      "Patient work at the loom, every thread chosen and placed. Research and prose woven by the same hand, even when the pattern was suggested elsewhere.",
  },
  "F---": {
    image: fInvestigator,
    title: "A Philosopher Lecturing on the Orrery",
    artist: "Joseph Wright of Derby",
    year: "c. 1766",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Wright_of_Derby,_The_Orrery.jpg",
    rationale:
      "Figures gathered around a mechanical model of the solar system, illuminated by a single light source. The painting is about investigation as a mode of being.",
  },
  "-LOW": {
    image: lowAuteur,
    title: "The Art of Painting",
    artist: "Johannes Vermeer",
    year: "c. 1666–68",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Jan_Vermeer_-_The_Art_of_Painting_-_Google_Art_Project.jpg",
    rationale:
      "Vermeer painting an allegory in his own studio: vision, composition, and execution all his.",
  },
  "-LO-": {
    image: loThinker,
    title: "I Lock My Door Upon Myself (detail)",
    artist: "Fernand Khnopff",
    year: "1891",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Detail,_I_lock_my_door_upon_myself,_Khnopff.png",
    rationale:
      "A figure withdrawn into private contemplation. The Thinker shapes ideas and structure inwardly, then hands the words to another voice.",
  },
  "-L-W": {
    image: lwVoice,
    title: "Madame X (Madame Pierre Gautreau)",
    artist: "John Singer Sargent",
    year: "1884",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Madame_X_(Madame_Pierre_Gautreau)_MET_DT278076.jpg",
    rationale:
      "All presence and silhouette, Madame X commands the canvas through sheer personality. The scandal the painting caused when first exhibited speaks to its raw expressive power.",
  },
  "-L--": {
    image: lSpark,
    title: "The Kiss",
    artist: "Gustav Klimt",
    year: "1907–08",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg",
    rationale:
      "One luminous gesture, everything else melting into gold. The Spark contributes the single charged idea around which everything else is arranged.",
  },
  "--OW": {
    image: owCraftsperson,
    title: "The Great Wave off Kanagawa",
    artist: "Katsushika Hokusai",
    year: "c. 1831",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Tsunami_by_hokusai_19th_century.jpg",
    rationale:
      "Hokusai did not invent the wave or the mountain but his structural and technical mastery transformed them into an icon. This is craftsmanship at its purest.",
  },
  "--O-": {
    image: oOrganizer,
    title: "Portrait of Lalla Vandervelde",
    artist: "Roger Fry",
    year: "1917",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Lalla_Vandervelde_(1917)_by_Roger_Fry.png",
    rationale:
      "A formalist's portrait: colour, plane, and arrangement above all. The Organizer brings order and proportion.",
  },
  "---W": {
    image: wScribe,
    title: "The Evangelist Matthew Inspired by the Angel",
    artist: "Rembrandt van Rijn",
    year: "1661",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Rembrandt_Harmensz._van_Rijn_049.jpg",
    rationale:
      "The angel whispers, the evangelist writes. The Scribe gives the words their final shape, through tone or rhythm or breath, even when the inspiration came from elsewhere.",
  },
  "----": {
    image: conductor,
    title: "Nocturne in Black and Gold – The Falling Rocket",
    artist: "James Abbott McNeill Whistler",
    year: "c. 1875",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:James_Abbott_McNeill_Whistler_-_Nocturne_in_Black_and_Gold_%E2%80%93_The_Falling_Rocket.jpg",
    rationale:
      "A scatter of sparks against the dark, arranged into a single atmosphere. The Conductor selects, frames, and approves, whereas the gestures themselves come from many hands.",
  },
};
