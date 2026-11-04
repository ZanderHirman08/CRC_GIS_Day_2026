/*
 * ─────────────────────────────────────────────────────────────
 *  PAGE SETTINGS — all text, colors and options live here.
 *  Empty strings ("") show as a visible [placeholder] on the page
 *  so you can see where each piece of text goes.
 * ─────────────────────────────────────────────────────────────
 */

window.CONFIG = {
  // ── Text (yours to write) ──────────────────────────────────
  text: {
    pageTitle: "",          // browser tab title
    title: "",              // big heading
    subtitle: "",           // line under the heading
    intro: "",              // paragraph under the subtitle
    backLink: { label: "", url: "https://zanderhirman08.github.io/CRCProjects-/" },
    footer: "",             // sources / credits line at the bottom (HTML allowed)

    // Line under the county name. HTML allowed. Tokens filled from the data:
    //   {count} buildings   {footprint} footprint (sq mi)   {land} county land (sq mi)
    //   {share} footprint as % of land   {median} median footprint (ft²)
    //   {top1} % of footprint in the largest 1%
    //   {smallHalf} % of footprint in the smallest half
    // e.g. "<b>{count}</b> buildings · {footprint} sq mi of footprint"
    facts: "",

    // Tabs and controls
    tabs: { map: "Map", sorted: "Sorted", stats: "Stats" },
    controls: {
      group: "Group by class",
      align: "Long side horizontal",
      show: "Show",
      showAll: "All",
      showLargest: "Largest N",
      showSmallest: "Smallest N",
      n: "N",
      // Group label suffix when showing largest/smallest N; {n} and {total} are filled in
      largestLabel: "largest {n} of {total}",
      smallestLabel: "smallest {n} of {total}",
      reset: "Reset view",
      poster: "Save poster PNG"
    },

    // Stats tab headings and notes
    stats: {
      byClass: "",          // heading above the count vs. footprint bars
      bySize: "",           // heading above the size-bin bars
      concentration: "",    // heading above the concentration numbers
      largest: "",          // heading above the top-10 table
      allCounties: "",      // heading above the all-county comparison
      concentrationText: "",  // body under "concentration"; same {tokens} as facts
      largestCols: ["Type (PRIM_OCC)", "Class", "ft²"],
      rowBuildings: "Buildings",
      rowFootprint: "Footprint"
    },

    // Panel shown when you click a building on the map.
    // Fill-ins: {rank} (e.g. 1,235th), {total}, {class} (its OCC_CLS), {county}
    selection: {
      countyHeading: "In {county} County",
      crcHeading: "Across all 10 CRC counties",
      rankAll: "{rank} largest of {total} buildings",
      rankClass: "{rank} largest of {total} {class} buildings",
      close: "Close"
    },

    // Poster PNG
    poster: {
      title: "",            // defaults to text.title if empty
      subtitle: "",         // shown under the title; {county} is replaced with the county name
      credits: ""           // small print at the bottom
    }
  },

  // ── Colors ─────────────────────────────────────────────────
  // One color per OCC_CLS class, from the APA LBCS color scheme (Structure/Function
  // dimensions). Where LBCS gives two classes the same hue (Government/Education blue,
  // Industrial/Assembly purple) they are split by lightness, and blues/purples are
  // lightened enough to show on the dark background. Residential is a muted LBCS yellow;
  // Utility uses LBCS gray52. Every pair checked for
  // normal-vision and colorblind separation; re-check if you change any of them.
  classColors: {
    "Residential":      "#c9b458",
    "Commercial":       "#ff0000",
    "Industrial":       "#980be7",
    "Government":       "#659cff",
    "Education":        "#345cbb",
    "Agriculture":      "#228b22",
    "Assembly":         "#d3b3fe",
    "Utility and Misc": "#868686",
    "Unclassified":     "#ffffff"
  },

  // Display names for the classes (leave as-is or rename)
  classLabels: {},

  // Colors for the size bins in the Stats tab (smallest → largest)
  sizeColors: ["#0e5a5a", "#157a7a", "#1f9aa6", "#5cc0c8", "#a3dfe3"],
  sizeLabels: ["under 500 ft²", "500–2,000 ft²", "2,000–10,000 ft²", "10,000–100,000 ft²", "over 100,000 ft²"],

  // Page colors (also set as CSS variables)
  theme: {
    bg: "#0f1115",
    panel: "#161920",
    line: "#2a2e37",
    text: "#e8eaee",
    sub: "#c9ccd3",
    muted: "#8a8f99",
    accent: "#e0573e",      // selected tab, picker highlight, facts numbers
    countyOutline: "#4a5060",
    hover: "#00e5ff",
    selected: "#00e5ff",    // outline of the clicked building
    font: "system-ui, -apple-system, 'Segoe UI', sans-serif"
  },

  // ── Behavior ───────────────────────────────────────────────
  defaultCounty: "chatham",     // slug from data/index.json
  defaultView: "map",           // "map" | "sorted" | "stats"
  defaultGroup: true,           // sorted view grouped by class
  defaultAlign: true,
  defaultShow: "all",           // sorted view: "all" | "largest" | "smallest"
  defaultN: 500,                // N buildings per class for largest/smallest
  animationMs: 1600,
  dimAlpha: 0.12,               // opacity of classes that are switched off in the legend
  minPixelSize: 1,              // smallest on-screen size of a building (px); 0 = true size

  // Poster export size in pixels (24 × 36 in at 300 dpi = 7200 × 10800)
  posterSize: { width: 7200, height: 10800 }
};
