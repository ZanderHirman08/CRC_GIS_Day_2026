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

    // Poster PNG
    poster: {
      title: "",            // defaults to text.title if empty
      subtitle: "",         // shown under the title; {county} is replaced with the county name
      credits: ""           // small print at the bottom
    }
  },

  // ── Colors ─────────────────────────────────────────────────
  // One color per OCC_CLS class, in this order. Replace the placeholder gray.
  classColors: {
    "Residential":      "#888888",
    "Commercial":       "#888888",
    "Industrial":       "#888888",
    "Government":       "#888888",
    "Education":        "#888888",
    "Agriculture":      "#888888",
    "Assembly":         "#888888",
    "Utility and Misc": "#888888",
    "Unclassified":     "#888888"
  },

  // Display names for the classes (leave as-is or rename)
  classLabels: {},

  // Colors for the size bins in the Stats tab (smallest → largest)
  sizeColors: ["#888888", "#888888", "#888888", "#888888", "#888888"],
  sizeLabels: ["under 500 ft²", "500–2,000 ft²", "2,000–10,000 ft²", "10,000–100,000 ft²", "over 100,000 ft²"],

  // Page colors (also set as CSS variables)
  theme: {
    bg: "#0f1115",
    panel: "#161920",
    line: "#2a2e37",
    text: "#e8eaee",
    sub: "#c9ccd3",
    muted: "#8a8f99",
    accent: "#888888",      // selected tab, picker highlight, facts numbers
    countyOutline: "#4a5060",
    hover: "#ffffff",
    font: "system-ui, -apple-system, 'Segoe UI', sans-serif"
  },

  // ── Behavior ───────────────────────────────────────────────
  defaultCounty: "chatham",     // slug from data/index.json
  defaultView: "map",           // "map" | "sorted" | "stats"
  defaultGroup: true,           // sorted view grouped by class
  defaultAlign: true,
  animationMs: 1600,
  dimAlpha: 0.12,               // opacity of classes that are switched off in the legend

  // Poster export size in pixels (24 × 36 in at 300 dpi = 7200 × 10800)
  posterSize: { width: 7200, height: 10800 }
};
