import type { EditorState } from "./editor/model.ts";
import { blankState, editorFromDraft } from "./editor/model.ts";

/**
 * Original layout drafts in the official abs/xyxy schema.
 * They are starting points for the editor, not model outputs.
 */
const poster = {
  width: 1024,
  height: 1536,
  bbox_coord_space: "abs" as const,
  bbox_format: "xyxy" as const,
  summary: {
    meta: ["poster", "travel"],
    canvas: "single" as const,
    palette: ["warm off-white", "rust orange", "dark teal", "black"],
    caption:
      "A vertical travel poster on warm off-white paper. A large rust-orange sun sits behind a dark teal mountain ridge. The title occupies the upper left, and a short place line sits near the bottom.",
  },
  items: [
    {
      label: "object" as const,
      caption: "A flat rust-orange sun, partly covered by the ridge, with a soft edge and no outline or rays.",
      bbox: [520, 160, 980, 640] as [number, number, number, number],
    },
    {
      label: "object" as const,
      caption: "A dark teal mountain ridge in flat color, higher toward the right, with a thin cream highlight along the skyline.",
      bbox: [0, 480, 1024, 1120] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Enormous condensed black title in two lines, left aligned, with tight leading and no background panel.",
      text: "NORTH\nWIND",
      bbox: [64, 80, 720, 340] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Small black uppercase place name with wide letter-spacing.",
      text: "LAKE DISTRICT",
      bbox: [64, 1288, 760, 1360] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Smaller black uppercase line beneath the place name.",
      text: "OPEN RIDGES",
      bbox: [64, 1376, 520, 1440] as [number, number, number, number],
    },
  ],
};

const menu = {
  width: 1024,
  height: 1536,
  bbox_coord_space: "abs" as const,
  bbox_format: "xyxy" as const,
  summary: {
    meta: ["menu", "print"],
    canvas: "single" as const,
    palette: ["cream", "dark green", "copper"],
    caption:
      "A cream restaurant menu with a dark green header band, two columns of dishes, a thin copper rule, and a short footer. Titles are serif; dish names and prices are a plain grotesque.",
  },
  items: [
    {
      label: "object" as const,
      caption: "A dark green rectangular header band across the top of the page.",
      bbox: [40, 36, 984, 220] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Large cream serif title, two lines, inside the green band.",
      text: "THE SALT\nHOUSE",
      bbox: [72, 56, 760, 168] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Small cream uppercase line along the bottom of the green band.",
      text: "LUNCH FROM ELEVEN",
      bbox: [72, 168, 640, 208] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Dark green section label, small caps, left column.",
      text: "SMALL PLATES",
      bbox: [56, 256, 480, 312] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Left column of dish names and prices in black, with a short description under each name.",
      text: "OYSTER · 4\nLEMON, RYE CRACKER\n\nBEANS · 8\nCHILI, DILL, OIL\n\nGREENS · 7\nSESAME, ORANGE",
      bbox: [56, 320, 490, 760] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Dark green section label, small caps, right column.",
      text: "MAINS",
      bbox: [530, 256, 960, 312] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Right column of dish names and prices in black, with a short description under each name.",
      text: "COD · 18\nBROWN BUTTER, CAPERS\n\nMUSHROOM PIE · 16\nTHYME, GREENS\n\nLENTILS · 14\nCARROT, YOGURT",
      bbox: [530, 320, 980, 780] as [number, number, number, number],
    },
    {
      label: "object" as const,
      caption: "A thin copper horizontal rule.",
      bbox: [56, 820, 968, 832] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Short centered note in black serif, two lines.",
      text: "BREAD AND BUTTER\nFOR THE TABLE",
      bbox: [56, 856, 720, 980] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Small footer in dark green, two lines.",
      text: "12 HARBOR STREET\nOPEN TILL NINE",
      bbox: [56, 1320, 760, 1464] as [number, number, number, number],
    },
  ],
};

const comic = {
  width: 1536,
  height: 1024,
  bbox_coord_space: "abs" as const,
  bbox_format: "xyxy" as const,
  summary: {
    meta: ["comic"],
    canvas: "multi_panel" as const,
    palette: ["white", "black", "yellow", "warm bakery light"],
    caption:
      "A three-panel color comic page on white paper with thin black panel borders. A cyclist in a yellow raincoat rides a rainy street, then steps into a bright bakery.",
  },
  items: [
    {
      label: "object" as const,
      caption: "A tall comic panel with a thin black border. Inside, a rainy gray street and a wet sidewalk.",
      bbox: [40, 36, 500, 988] as [number, number, number, number],
    },
    {
      label: "character" as const,
      caption: "A person in a yellow raincoat and red boots, seen from the side, pedaling a simple black bicycle.",
      bbox: [80, 420, 460, 920] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Short handwritten speech in a white balloon with a tail pointing to the cyclist.",
      text: "Almost there.",
      bbox: [70, 70, 460, 210] as [number, number, number, number],
    },
    {
      label: "object" as const,
      caption: "A wide comic panel with a thin black border. Inside, a bakery doorway and warm yellow light.",
      bbox: [540, 36, 1496, 470] as [number, number, number, number],
    },
    {
      label: "character" as const,
      caption: "The same person stepping through the doorway, raincoat half open, holding the bicycle.",
      bbox: [580, 150, 980, 440] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Handwritten speech in a white balloon, two lines, tail pointing to the person in the doorway.",
      text: "ONE BUN,\nPLEASE.",
      bbox: [1020, 70, 1450, 230] as [number, number, number, number],
    },
    {
      label: "object" as const,
      caption: "A wide comic panel with a thin black border. Inside, a wooden counter.",
      bbox: [540, 510, 1496, 988] as [number, number, number, number],
    },
    {
      label: "object" as const,
      caption: "A round cinnamon bun on a ceramic plate, with a paper bag beside it.",
      bbox: [600, 600, 980, 940] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "A small caption in handwritten black letters, two lines, no balloon.",
      text: "NEXT STOP:\nHOME.",
      bbox: [1040, 640, 1440, 860] as [number, number, number, number],
    },
  ],
};

const cover = {
  width: 768,
  height: 1152,
  bbox_coord_space: "abs" as const,
  bbox_format: "xyxy" as const,
  summary: {
    meta: ["book cover"],
    canvas: "single" as const,
    palette: ["ink navy", "cream", "copper"],
    caption:
      "A portrait book cover with an ink-navy field, a cream horizontal band across the lower third, and a single illustrated figure standing in the upper half.",
  },
  items: [
    {
      label: "character" as const,
      caption: "A standing figure in a long copper-colored coat, small against the navy field, facing slightly left, with simple flat shading.",
      bbox: [210, 120, 570, 700] as [number, number, number, number],
    },
    {
      label: "object" as const,
      caption: "A cream horizontal band across the lower third, with no border.",
      bbox: [0, 748, 768, 1152] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Large navy serif title on the cream band, two lines, left aligned.",
      text: "FIELD\nNOTES",
      bbox: [48, 790, 720, 980] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Small copper uppercase author line.",
      text: "M. ELLISON",
      bbox: [48, 1000, 520, 1064] as [number, number, number, number],
    },
    {
      label: "text" as const,
      caption: "Tiny navy uppercase imprint at the bottom of the cream band.",
      text: "NORTH PRESS",
      bbox: [48, 1080, 440, 1128] as [number, number, number, number],
    },
  ],
};

export const exampleDrafts = {
  poster,
  menu,
  comic,
  cover,
} as const;

export type ExampleName = keyof typeof exampleDrafts;

export const exampleLabels: Record<ExampleName, string> = {
  poster: "Poster",
  menu: "Menu",
  comic: "Comic",
  cover: "Book cover",
};

export function createExample(name: ExampleName | "blank"): EditorState {
  if (name === "blank") return blankState();
  return editorFromDraft(exampleDrafts[name]);
}
