/* ShadeGap DFW 2.0 — Bus Stop Heat What-If Planner
 * GISC 6363 Final Project · Samia Riaz · ArcGIS Maps SDK for JavaScript 5.1
 *
 * New components (not covered in the course labs):
 *   1. arcgis-sketch                 – what-if planner (trees, shelters, area summary)
 *   2. arcgis-swipe                  – surface temperature vs tree cover, summer 2026
 *   3. arcgis-feature-table          – priority list linked to the map and filters
 *   4. arcgis-histogram-range-slider – filter stops on the HEI distribution
 *   5. arcgis-print                  – export the current planning view
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
  stopsUrl: "https://services2.arcgis.com/VNo0ht0YPXJoI4oE/arcgis/rest/services/shadegap_bus_stops_2026/FeatureServer/0",
  lstCogUrl: "data/ShadeGap_LST_2026_cog.tif",     // °C × 10, int16
  treesCogUrl: "data/ShadeGap_Trees_2026_cog.tif", // tree probability × 100, uint8
  referenceUrl: "data/hei_reference.json",
  waitRadiusM: 30,     // waiting area used when the index was built
  shelterRadiusM: 15,  // a shelter shades stops within this distance
};

const PRIORITY = [
  { name: "Low",       min: -1, max: 40,  color: "#f6d55c" },
  { name: "Moderate",  min: 40, max: 55,  color: "#f28e2b" },
  { name: "High",      min: 55, max: 70,  color: "#e15759" },
  { name: "Very high", min: 70, max: 101, color: "#8c1d18" },
];
const priorityOf = (hei) => (PRIORITY.find((p) => hei > p.min && hei <= p.max) || PRIORITY[0]).name;

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
const [
  ArcGISMap, Basemap, TileLayer, FeatureLayer, GraphicsLayer, Graphic, ImageryTileLayer,
  LayerSearchSource, reactiveUtils, histogram, geodeticDistanceOperator, TableTemplate, FieldColumnTemplate,
] = await $arcgis.import([
  "@arcgis/core/Map.js",
  "@arcgis/core/Basemap.js",
  "@arcgis/core/layers/TileLayer.js",
  "@arcgis/core/layers/FeatureLayer.js",
  "@arcgis/core/layers/GraphicsLayer.js",
  "@arcgis/core/Graphic.js",
  "@arcgis/core/layers/ImageryTileLayer.js",
  "@arcgis/core/widgets/Search/LayerSearchSource.js",
  "@arcgis/core/core/reactiveUtils.js",
  "@arcgis/core/smartMapping/statistics/histogram.js",
  "@arcgis/core/geometry/operators/geodeticDistanceOperator.js",
  "@arcgis/core/widgets/FeatureTable/support/TableTemplate.js",
  "@arcgis/core/widgets/FeatureTable/support/FieldColumnTemplate.js",
]);

const $ = (sel) => document.querySelector(sel);
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------------------
// Map and layers
// ---------------------------------------------------------------------------
// Public, key-free basemap (Esri Light Gray Canvas raster tiles)
const basemap = new Basemap({
  baseLayers: [new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer" })],
  referenceLayers: [new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer" })],
  title: "Light Gray Canvas",
});

const lstLayer = new ImageryTileLayer({
  url: CONFIG.lstCogUrl,
  title: "Surface temperature, Jun–Aug 2026 (°C)",
  visible: false,
  opacity: 0.8,
  renderer: {
    type: "raster-stretch",
    stretchType: "min-max",
    customStatistics: [{ min: 380, max: 540, avg: 460, stddev: 30 }], // 38–54 °C (stored ×10)
    dynamicRangeAdjustment: false,
    colorRamp: {
      type: "multipart",
      colorRamps: [
        { type: "algorithmic", fromColor: [49, 54, 149], toColor: [254, 224, 144] },
        { type: "algorithmic", fromColor: [254, 224, 144], toColor: [165, 0, 38] },
      ],
    },
  },
});

const treesLayer = new ImageryTileLayer({
  url: CONFIG.treesCogUrl,
  title: "Tree cover probability, Jun–Aug 2026 (%)",
  visible: false,
  opacity: 0.85,
  renderer: {
    type: "raster-stretch",
    stretchType: "min-max",
    customStatistics: [{ min: 0, max: 60, avg: 15, stddev: 15 }],
    dynamicRangeAdjustment: false,
    colorRamp: { type: "algorithmic", fromColor: [247, 252, 245], toColor: [0, 68, 27] },
  },
});

const stopsLayer = new FeatureLayer({
  url: CONFIG.stopsUrl,
  title: "DART bus stops · Heat Exposure Index",
  outFields: ["*"],
  minScale: 0, // the hosted layer defaults to 1:247,863, which hides stops at city scale
  maxScale: 0,
  renderer: {
    type: "class-breaks",
    field: "hei",
    legendOptions: { title: "Heat Exposure Index" },
    classBreakInfos: PRIORITY.map((p) => ({
      minValue: Math.max(p.min, 0), maxValue: Math.min(p.max, 100),
      label: `${p.name} (${Math.max(p.min, 0)}–${Math.min(p.max, 100)})`,
      symbol: { type: "simple-marker", size: p.name === "Very high" ? 6.5 : 5, color: p.color,
                outline: { color: [255, 255, 255, 0.7], width: 0.4 } },
    })),
  },
  popupTemplate: {
    title: "{stop_name}",
    // template-level formats also apply to {field} placeholders in the text element
    fieldInfos: [
      { fieldName: "hei", format: { places: 1, digitSeparator: false } },
      { fieldName: "hei_rank", format: { places: 0, digitSeparator: true } },
    ],
    content: [
      {
        type: "text",
        text: `<b style="font-size:15px">HEI {hei}</b> · {priority} priority · rank {hei_rank} of 6,837`,
      },
      {
        type: "fields",
        fieldInfos: [
          { fieldName: "routes", label: "Routes" },
          { fieldName: "lst_c", label: "Surface temperature, summer 2026 (°C)", format: { places: 1 } },
          { fieldName: "tree_idx", label: "Tree index (0–100, 30 m area)", format: { places: 1 } },
          { fieldName: "svi_rpl", label: "Social vulnerability (SVI percentile)", format: { places: 2 } },
          { fieldName: "trips_in_feed", label: "Scheduled trips in feed", format: { digitSeparator: true, places: 0 } },
        ],
      },
    ],
  },
});

const scenarioInput = new GraphicsLayer({ title: "What-if: proposed trees & shelters", listMode: "hide" });
const scenarioResults = new GraphicsLayer({ title: "What-if: affected stops", listMode: "hide" });

const mapEl = $("#main-map");
mapEl.map = new ArcGISMap({ basemap, layers: [lstLayer, treesLayer, stopsLayer, scenarioResults, scenarioInput] });
await mapEl.viewOnReady();
const view = mapEl.view;

await stopsLayer.load();
const stopsLayerView = await view.whenLayerView(stopsLayer);

// Open on the DART service area and make it the Home view
try {
  const { extent } = await stopsLayer.queryExtent();
  if (extent) {
    await view.goTo(extent.expand(1.02), { animate: false });
    const homeEl = document.querySelector("arcgis-home");
    if (homeEl) homeEl.viewpoint = view.viewpoint.clone();
  }
} catch (err) { console.warn("Could not zoom to stops", err); }
if (!geodeticDistanceOperator.isLoaded()) await geodeticDistanceOperator.load();

// Reference distributions used to recompute percentiles in the browser
const ref = await (await fetch(CONFIG.referenceUrl)).json();
const W = ref.weights;
const treeSorted = ref.tree_sorted;
/** Percentile (0–1) of value v in a sorted array: share of values ≤ v */
function pctRank(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
  return lo / sorted.length;
}
const heiFrom = (pctLst, pctTree, svi) => 100 * (W.heat * pctLst + W.shade * (1 - pctTree) + W.svi * svi);

// Header statistics
/** Read a statistics result regardless of the case the server uses for field names */
const statVal = (attrs, name) => {
  const key = Object.keys(attrs ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? attrs[key] : null;
};
$("#header-stats").innerHTML =
  `<div class="stat"><b id="st-n">–</b>bus stops</div>` +
  `<div class="stat"><b id="st-vh">–</b>very high priority</div>` +
  `<div class="stat"><b id="st-lst">–</b>mean surface temp</div>`;
stopsLayer.queryFeatureCount({ where: "1=1" })
  .then((n) => { $("#st-n").textContent = n.toLocaleString(); })
  .catch((err) => console.warn("Header: stop count failed", err));
stopsLayer.queryFeatureCount({ where: "priority = 'Very high'" })
  .then((n) => { $("#st-vh").textContent = n.toLocaleString(); })
  .catch((err) => console.warn("Header: very-high count failed", err));
(() => {
  const q = stopsLayer.createQuery();
  q.where = "1=1";
  q.outStatistics = [{ statisticType: "avg", onStatisticField: "lst_c", outStatisticFieldName: "lst_avg" }];
  stopsLayer.queryFeatures(q)
    .then((r) => { $("#st-lst").textContent = `${fmt(statVal(r.features[0]?.attributes, "lst_avg"))} °C`; })
    .catch((err) => console.warn("Header: mean LST failed", err));
})();

// ---------------------------------------------------------------------------
// Search (find a stop by name or route)
// ---------------------------------------------------------------------------
const searchEl = $("#search");
searchEl.sources = [
  new LayerSearchSource({
    layer: stopsLayer,
    searchFields: ["stop_name", "routes"],
    displayField: "stop_name",
    suggestionTemplate: "{stop_name} · routes {routes} · HEI {hei}",
    exactMatch: false,
    outFields: ["*"],
    name: "DART bus stops",
    placeholder: "Find a stop, e.g. Jefferson",
    zoomScale: 4000,
  }),
];

// ---------------------------------------------------------------------------
// Feature Table (component 3)
// ---------------------------------------------------------------------------
const tableEl = $("#table");
tableEl.layer = stopsLayer;
tableEl.tableTitle = "Stops ranked by heat exposure · click a row to zoom";
const col = (fieldName, label, extra = {}) => new FieldColumnTemplate({ fieldName, label, ...extra });
tableEl.tableTemplate = new TableTemplate({
  columnTemplates: [
    col("hei_rank", "Rank", { direction: "asc", initialSortPriority: 0, width: 66 }),
    col("stop_name", "Stop", { flexGrow: 1 }),
    col("routes", "Routes", { visible: false }),
    col("hei", "HEI", { width: 66 }),
    col("priority", "Priority", { width: 96 }),
    col("lst_c", "LST °C", { width: 76 }),
    col("tree_idx", "Tree index", { visible: false }),
    col("svi_rpl", "SVI", { visible: false }),
    col("trips_in_feed", "Trips", { visible: false }),
  ],
});
// Click a row: zoom to that stop and open its pop-up
tableEl.addEventListener("arcgisCellClick", async (e) => {
  const oid = e.detail?.feature?.attributes?.[stopsLayer.objectIdField];
  if (oid == null) return;
  const { features } = await stopsLayer.queryFeatures({ objectIds: [oid], outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference });
  if (!features.length) return;
  await view.goTo({ target: features[0], zoom: Math.max(view.zoom, 17) }, { duration: 700 });
  view.openPopup({ features, location: features[0].geometry });
});
// Selecting rows (checkbox) zooms to the whole selection
tableEl.addEventListener("arcgisSelectionChange", async (e) => {
  const ids = e.detail?.added ?? [];
  if (!ids.length) return;
  const { features } = await stopsLayer.queryFeatures({ objectIds: ids, returnGeometry: true, outSpatialReference: view.spatialReference });
  if (features.length) view.goTo({ target: features, zoom: Math.max(view.zoom, 15) }, { duration: 700 });
});

// ---------------------------------------------------------------------------
// Histogram range slider filter (component 4)
// ---------------------------------------------------------------------------
const sliderEl = $("#hei-slider");
const histo = await histogram({ layer: stopsLayer, field: "hei", numBins: 40, minValue: 0, maxValue: 100 });
Object.assign(sliderEl, {
  min: 0, max: 100, values: [0, 100], bins: histo.bins, rangeType: "between",
  precision: 0, label: "Heat Exposure Index",
  includedBarColor: "#e15759", excludedBarColor: "#d9d9d9",
  labelFormatFunction: (v) => Number(v).toFixed(0),
});

let filterWhere = "1=1";
async function applyFilter() {
  const [a, b] = sliderEl.values ?? [0, 100];
  filterWhere = a <= 0 && b >= 100 ? "1=1" : `hei >= ${a.toFixed(1)} AND hei <= ${b.toFixed(1)}`;
  stopsLayerView.featureEffect = filterWhere === "1=1" ? null : {
    filter: { where: filterWhere },
    excludedEffect: "grayscale(100%) opacity(18%)",
  };
  tableEl.definitionExpression = filterWhere === "1=1" ? null : filterWhere;
  const n = await stopsLayer.queryFeatureCount({ where: filterWhere });
  $("#filter-summary").innerHTML = `<span class="big">${n.toLocaleString()}</span> stops with HEI ${a.toFixed(0)}–${b.toFixed(0)}`;
}
let filterTimer;
reactiveUtils.watch(() => sliderEl.values, () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilter, 150); });
$("#reset-filter").addEventListener("click", () => {
  sliderEl.values = [0, 100];
  activePrio = null;
  document.querySelectorAll(".prio-row.active").forEach((r) => r.classList.remove("active"));
  applyFilter();
});

// Stops-by-priority breakdown (click a class to filter with the same slider)
let activePrio = null;
async function buildPriorityList() {
  const q = stopsLayer.createQuery();
  q.where = "1=1";
  q.groupByFieldsForStatistics = ["priority"];
  q.outStatistics = [
    { statisticType: "count", onStatisticField: "hei", outStatisticFieldName: "n" },
    { statisticType: "avg", onStatisticField: "lst_c", outStatisticFieldName: "lst_avg" },
  ];
  const { features } = await stopsLayer.queryFeatures(q);
  const byName = Object.fromEntries(features.map((f) => [statVal(f.attributes, "priority"), f.attributes]));
  const total = features.reduce((t, f) => t + (statVal(f.attributes, "n") || 0), 0);
  const maxN = Math.max(...features.map((f) => statVal(f.attributes, "n") || 0));
  $("#prio-list").innerHTML = [...PRIORITY].reverse().map((p) => {
    const a = byName[p.name] ?? {};
    const n = statVal(a, "n") || 0;
    return `<div class="prio-row" data-p="${p.name}" title="Mean surface temp ${fmt(statVal(a, "lst_avg"))} °C">
      <span>${p.name}</span>
      <span class="prio-bar" style="width:${(100 * n / maxN).toFixed(1)}%;background:${p.color}"></span>
      <span class="prio-num"><b>${n.toLocaleString()}</b> · ${(100 * n / total).toFixed(0)}%</span></div>`;
  }).join("");
  $("#prio-list").querySelectorAll(".prio-row").forEach((row) => row.addEventListener("click", () => {
    const p = PRIORITY.find((x) => x.name === row.dataset.p);
    activePrio = activePrio === p.name ? null : p.name;
    $("#prio-list").querySelectorAll(".prio-row").forEach((r) => r.classList.toggle("active", r.dataset.p === activePrio));
    sliderEl.values = activePrio ? [Math.max(p.min, 0) + (p.min > 0 ? 0.05 : 0), Math.min(p.max, 100)] : [0, 100];
    applyFilter();
  }));
}
buildPriorityList().catch((err) => console.warn("Priority breakdown failed", err));
applyFilter();

// ---------------------------------------------------------------------------
// Raster views and Swipe (component 2)
// ---------------------------------------------------------------------------
let swipeEl = null;
function setRasterMode(mode) {
  if (swipeEl) { swipeEl.remove(); swipeEl = null; }
  lstLayer.visible = mode === "lst" || mode === "swipe";
  treesLayer.visible = mode === "trees" || mode === "swipe";
  if (mode === "swipe") {
    swipeEl = document.createElement("arcgis-swipe");
    swipeEl.leadingLayers = [lstLayer];
    swipeEl.trailingLayers = [treesLayer];
    swipeEl.direction = "horizontal";
    swipeEl.position = 50;
    mapEl.appendChild(swipeEl);
  }
}
$("#raster-mode").addEventListener("calciteSegmentedControlChange", (e) => setRasterMode(e.target.value));

// ---------------------------------------------------------------------------
// What-if planner with Sketch (component 1)
// ---------------------------------------------------------------------------
const SYMBOLS = {
  tree: { type: "simple-marker", style: "circle", size: 16, color: [46, 139, 87, 0.85], outline: { color: "#0b3d20", width: 1.5 } },
  shelter: { type: "simple-marker", style: "square", size: 14, color: [40, 110, 200, 0.9], outline: { color: "#0b2a55", width: 1.5 } },
};
let placeKind = "tree";
let crownR = 6;

const sketchEl = $("#sketch");
sketchEl.layer = scenarioInput;
sketchEl.pointSymbol = SYMBOLS.tree;
sketchEl.polygonSymbol = { type: "simple-fill", color: [255, 170, 0, 0.12], outline: { color: [200, 110, 0], width: 2, style: "dash" } };

$("#place-kind").addEventListener("calciteSegmentedControlChange", (e) => {
  placeKind = e.target.value;
  sketchEl.pointSymbol = SYMBOLS[placeKind];
  $("#crown-label").hidden = placeKind !== "tree";
});
$("#crown-size").addEventListener("calciteSegmentedControlChange", (e) => { crownR = Number(e.target.value); });

sketchEl.addEventListener("arcgisCreate", (e) => {
  const { state, graphic } = e.detail;
  if (state !== "complete" || !graphic) return;
  if (graphic.geometry.type === "point") {
    // Placement needs street-level precision: the waiting area is only 30 m wide
    if (view.scale > 6000) {
      scenarioInput.remove(graphic);
      view.goTo({ target: graphic.geometry, scale: 2500 }, { duration: 800 });
      $("#scenario-summary").innerHTML =
        `<b>Zoomed in to street level.</b> Choose the point tool again and click within ~20 m of a stop.`;
      return;
    }
    graphic.attributes = { kind: placeKind, crownR: placeKind === "tree" ? crownR : null };
    graphic.symbol = SYMBOLS[placeKind];
    recomputeScenario();
  } else {
    summarizeArea(graphic.geometry);
  }
});
sketchEl.addEventListener("arcgisUpdate", (e) => {
  if (e.detail.state !== "complete") return;
  const g = e.detail.graphics?.[0];
  if (g?.geometry?.type === "polygon") summarizeArea(g.geometry);
  recomputeScenario();
});
sketchEl.addEventListener("arcgisDelete", () => recomputeScenario());
$("#clear-scenario").addEventListener("click", () => {
  scenarioInput.removeAll();
  recomputeScenario();
  tableEl.filterGeometry = null;
  $("#area-summary").innerHTML = "<em>Draw a polygon or rectangle to summarize an area.</em>";
});

/** Share of the 30 m waiting area covered by a crown of radius r whose centre is d metres from the stop.
 *  Exact circle–circle overlap area divided by the waiting-area area. */
function crownCoverShare(d, r, R = CONFIG.waitRadiusM) {
  if (d >= R + r) return 0;
  if (d <= R - r) return (r * r) / (R * R);
  const a1 = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r));
  const a2 = R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R));
  const a3 = 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return (a1 + a2 - a3) / (Math.PI * R * R);
}

let scenarioToken = 0;
async function recomputeScenario() {
  const token = ++scenarioToken;
  const items = scenarioInput.graphics.toArray().filter((g) => g.geometry?.type === "point" && g.attributes?.kind);
  scenarioResults.removeAll();
  if (!items.length) {
    $("#scenario-summary").innerHTML = "<em>No trees or shelters placed yet.</em>";
    $("#scenario-list").innerHTML = "";
    return;
  }

  // 1. Find candidate stops near each proposed item (server-side distance query)
  const affected = new Map(); // objectId -> { feature, addTree, shelter }
  const oidField = stopsLayer.objectIdField;
  for (const g of items) {
    const reach = g.attributes.kind === "tree" ? CONFIG.waitRadiusM + g.attributes.crownR : CONFIG.shelterRadiusM;
    const { features } = await stopsLayer.queryFeatures({
      geometry: g.geometry, distance: reach, units: "meters", spatialRelationship: "intersects",
      outFields: [oidField, "stop_name", "routes", "lst_c", "tree_idx", "svi_rpl", "pct_lst", "hei", "priority"],
      returnGeometry: true, outSpatialReference: view.spatialReference,
    });
    for (const f of features) {
      const id = f.attributes[oidField];
      const rec = affected.get(id) ?? { feature: f, addTree: 0, shelter: false };
      const d = geodeticDistanceOperator.execute(g.geometry, f.geometry, { unit: "meters" });
      if (g.attributes.kind === "tree") rec.addTree += 100 * crownCoverShare(d, g.attributes.crownR);
      else if (d <= CONFIG.shelterRadiusM) rec.shelter = true;
      affected.set(id, rec);
    }
  }
  if (token !== scenarioToken) return; // a newer edit started

  // 2. Recompute HEI for each affected stop
  const rows = [];
  for (const { feature, addTree, shelter } of affected.values()) {
    const a = feature.attributes;
    if (!shelter && addTree <= 0) continue;
    const newTree = Math.min(100, a.tree_idx + addTree);
    const pctTree = shelter ? 1 : pctRank(treeSorted, newTree);
    const newHei = heiFrom(a.pct_lst, pctTree, a.svi_rpl);
    rows.push({ feature, a, newTree, newHei, delta: newHei - a.hei, shelter });
  }
  rows.sort((x, y) => x.delta - y.delta);

  // 3. Draw results
  for (const r of rows) {
    scenarioResults.addMany([
      new Graphic({ geometry: r.feature.geometry,
        symbol: { type: "simple-marker", size: 13, color: [0, 0, 0, 0], outline: { color: "#1e7b45", width: 2.5 } } }),
      new Graphic({ geometry: r.feature.geometry,
        symbol: { type: "text", text: fmt(r.delta), color: "#0d4d2a", haloColor: "white", haloSize: 1.5, yoffset: 11,
                  font: { size: 10, weight: "bold" } } }),
    ]);
  }

  const nTrees = items.filter((g) => g.attributes.kind === "tree").length;
  const nShelters = items.length - nTrees;
  const meanDelta = rows.length ? rows.reduce((s, r) => s + r.delta, 0) / rows.length : 0;
  const leftVeryHigh = rows.filter((r) => r.a.priority === "Very high" && priorityOf(r.newHei) !== "Very high").length;
  $("#scenario-summary").innerHTML = rows.length
    ? `${nTrees} tree${nTrees === 1 ? "" : "s"} · ${nShelters} shelter${nShelters === 1 ? "" : "s"} → ` +
      `<span class="big">${rows.length}</span> stop${rows.length === 1 ? "" : "s"} improved<br>` +
      `Mean HEI change <span class="good">${fmt(meanDelta)}</span> · ` +
      `<span class="good">${leftVeryHigh}</span> stop${leftVeryHigh === 1 ? "" : "s"} leave "Very high"`
    : `${items.length} item(s) placed, but no bus stop is close enough. Place trees within ~${CONFIG.waitRadiusM} m of a stop.`;

  $("#scenario-list").innerHTML = rows.length ? `
    <table>
      <thead><tr><th>Stop</th><th>HEI before → after</th><th>Priority</th></tr></thead>
      <tbody>${rows.slice(0, 25).map((r, i) => `
        <tr data-i="${i}">
          <td>${esc(r.a.stop_name)}${r.shelter ? " 🛖" : ""}</td>
          <td class="num">${fmt(r.a.hei)} → <b>${fmt(r.newHei)}</b> (${fmt(r.delta)})</td>
          <td><span class="pill ${esc(priorityOf(r.newHei))}">${esc(priorityOf(r.newHei))}</span></td>
        </tr>`).join("")}</tbody>
    </table>` : "";
  $("#scenario-list").querySelectorAll("tr[data-i]").forEach((tr) =>
    tr.addEventListener("click", () => view.goTo({ target: rows[+tr.dataset.i].feature.geometry, zoom: 18 }, { duration: 600 })));
}

/** Area summary for a sketched polygon: counts, mean HEI, and filters the table to the area */
async function summarizeArea(geometry) {
  $("#area-block").open = true;
  const q = stopsLayer.createQuery();
  q.geometry = geometry;
  q.spatialRelationship = "intersects";
  q.outStatistics = [
    { statisticType: "count", onStatisticField: "hei", outStatisticFieldName: "n" },
    { statisticType: "avg", onStatisticField: "hei", outStatisticFieldName: "hei_avg" },
    { statisticType: "max", onStatisticField: "hei", outStatisticFieldName: "hei_max" },
    { statisticType: "avg", onStatisticField: "lst_c", outStatisticFieldName: "lst_avg" },
    { statisticType: "avg", onStatisticField: "tree_idx", outStatisticFieldName: "tree_avg" },
  ];
  const raw = (await stopsLayer.queryFeatures(q)).features[0]?.attributes ?? {};
  const s = Object.fromEntries(["n", "hei_avg", "hei_max", "lst_avg", "tree_avg"].map((k) => [k, statVal(raw, k)]));
  const vh = await stopsLayer.queryFeatureCount({ geometry, spatialRelationship: "intersects", where: "priority = 'Very high'" });
  tableEl.filterGeometry = geometry;
  $("#area-summary").innerHTML = s.n
    ? `<span class="big">${s.n.toLocaleString()}</span> stops in the area · <b>${vh}</b> very high priority<br>` +
      `Mean HEI <b>${fmt(s.hei_avg)}</b> (max ${fmt(s.hei_max)}) · mean surface temp <b>${fmt(s.lst_avg)} °C</b> · ` +
      `mean tree index <b>${fmt(s.tree_avg)}</b><br><span class="hint">The table below now lists only these stops. Use "Clear scenario" to reset it.</span>`
    : "No bus stops inside this area.";
}

// ---------------------------------------------------------------------------
// Print (component 5)
// ---------------------------------------------------------------------------
// Configured in index.html (PDF / PNG, Esri's public print service). Graphics from the
// what-if scenario are included in the export, so a planner can print a proposal.

console.info("ShadeGap DFW 2.0 ready");
