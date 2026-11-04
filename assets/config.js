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
    title: "Every Building in the CRC",   // big heading
    subtitle: "292,209 buildings across 10 coastal Georgia counties · GIS Day 2026",   // line under the heading
    // paragraph under the subtitle (HTML allowed; links open in a new tab)
    intro: "Pick a county to see every building footprint (2018) in the Coastal Regional Commission region. " +
      "Switch to <em>Sorted</em> to line them up from largest to smallest, or open <em>Stats</em> for the breakdown " +
      "by building type and size. Click any building on the map to see how it ranks. Inspired by " +
      "<a href=\"https://abenrob.com/\">Adam Roberts</a>'s 30 Day Map Challenge, " +
      "<a href=\"https://abenrob.github.io/30daymap2026/day-03-polygons/#a=4&v=map\">day 3</a>.",
    // Sources / credits at the bottom of the page (HTML allowed)
    footer: "<b>Sources:</b> Building footprints: USA Structures, Oak Ridge National Laboratory (ORNL) and " +
      "FEMA Geospatial Response Office (data collection 2018), via the Coastal Regional Commission. " +
      "County boundaries: Coastal Regional Commission. Water: U.S. Census Bureau TIGER/Line 2026 area and " +
      "linear hydrography. Population and housing: U.S. Census Bureau, American Community Survey 2014–2018 " +
      "5-year estimates. Colors based on the APA Land-Based Classification Standards (LBCS).",

    // Line under the county name. HTML allowed. Tokens filled from the data:
    //   {count} buildings   {footprint} footprint (sq mi)   {land} county land (sq mi)
    //   {share} footprint as % of land   {median} median footprint (ft²)
    //   {top1} % of footprint in the largest 1%
    //   {smallHalf} % of footprint in the smallest half
    // Census (ACS 2018 5-year, added by scripts/add_census.py):
    //   {population}  {housingUnits}  {peoplePerBuilding} people per building
    //   {unitsPerHome} housing units per Residential footprint  {medianYearBuilt}
    //   {medianHomeValue}  {medianIncome}  {pctVacant}  {pctOwner}  {pctRenter}
    //   {pctSingleFamily}  {pctMultiFamily}  {pctMobileHome}  (share of housing units)
    // e.g. "<b>{count}</b> buildings · {footprint} sq mi of footprint"
    facts: "<b>{population}</b> people · <b>{housingUnits}</b> homes, built around <b>{medianYearBuilt}</b><br>" +
      "<b>{pctSingleFamily}</b> single-family · <b>{pctMobileHome}</b> mobile homes · <b>{pctVacant}</b> vacant · " +
      "median value <b>{medianHomeValue}</b>",

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

    // Mini-map (sorted view): shown until a building is clicked
    minimap: {
      hint: "Click a building to see where it is."
    },

    // Poster PNG
    poster: {
      title: "",            // defaults to text.title if empty
      subtitle: "",         // shown under the title; {county} is replaced with the county name
      credits: ""           // small print at the bottom
    }
  },

  // ── Colors ─────────────────────────────────────────────────
  // One color per OCC_CLS class, based on the APA LBCS color scheme: muted yellow
  // Residential, brick-red Commercial, and paired families for related classes —
  // Government/Education (light/dark blue) and Industrial/Utility (light/deep purple).
  // Every pair checked for normal-vision and colorblind separation on the dark
  // background; re-check if you change any of them.
  classColors: {
    "Residential":      "#c9b458",
    "Commercial":       "#944b41",
    "Industrial":       "#9c76f3",
    "Government":       "#5eaceb",
    "Education":        "#1e66d1",
    "Agriculture":      "#668e4f",
    "Assembly":         "#b6899d",
    "Utility and Misc": "#854da1",
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
    water: "#14273b",       // ocean, sounds, rivers (fill)
    river: "#2b4f73",       // river lines
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
