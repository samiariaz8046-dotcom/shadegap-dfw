# ShadeGap DFW 2.0: Bus Stop Heat What-If Planner

GISC 6363 Internet Mapping and Information Processing (UT Dallas, Fall 2026). Final project by Samia Riaz.

ShadeGap DFW 2.0 ranks heat exposure at **6,837 DART bus stops** for summer 2026. It also lets planners test where a new shade tree or bus shelter would lower exposure the most. The app is a pure HTML5 application built with the **ArcGIS Maps SDK for JavaScript 5.1**. It extends my midterm Experience Builder app, *ShadeGap DFW*.

## What changed since the midterm
The midterm feedback was that tree canopy and bus stop data should come from the same year. In this version, every layer that changes over time uses the **same period, June–August 2026**:

| Layer | Source | Period |
|---|---|---|
| Bus stops | DART GTFS feed | 2026 |
| Shade (tree index) | Dynamic World V1 `trees` probability, 10 m, averaged over a 30 m waiting area | Jun–Aug 2026 |
| Surface temperature | Landsat 8/9 Collection 2 Level-2 `ST_B10`, median | Jun–Aug 2026 |
| Social vulnerability | CDC/ATSDR SVI 2022 (newest release, census-based) | 2022 |

The shade measure was checked against USFS Tree Canopy Cover 2023 at every stop (Spearman ρ = 0.68). See `data/validation_tree_index.png`.

**Heat Exposure Index:** `HEI = 100 × (0.4·pct(LST) + 0.3·(1 − pct(tree index)) + 0.3·SVI)`

## Components added in code (not covered in the course labs)
1. **Sketch** (`arcgis-sketch`): the what-if planner. Place trees or shelters, and the HEI of nearby stops is recalculated in the browser. A polygon or rectangle summarizes the stops inside it.
2. **Swipe** (`arcgis-swipe`): compares the 2026 surface temperature and tree cover rasters, loaded as Cloud-Optimized GeoTIFFs.
3. **Feature Table** (`arcgis-feature-table`): ranked stop list, linked to the map, the histogram filter and the area tool.
4. **Histogram Range Slider** (`arcgis-histogram-range-slider`): filters stops on the HEI distribution.
5. **Print** (`arcgis-print`): exports the current planning view as PDF or PNG.

The app also uses Zoom, Home, Search, Legend, Expand and Scale Bar, which were covered in the labs.

## Files
```
index.html                     page layout (Calcite components + map components)
css/app.css                    styling
js/app.js                      application logic
data/hei_reference.json        sorted reference values used to recompute percentiles
data/ShadeGap_LST_2026_cog.tif     surface temperature COG (°C × 10)
data/ShadeGap_Trees_2026_cog.tif   tree probability COG (× 100)
notebooks/ShadeGap_2026_data.ipynb Colab + Earth Engine notebook that builds the data
```

## Run locally
Browsers block `fetch()` from `file://` pages, so serve the folder first:
```
python -m http.server 8000
```
Then open http://localhost:8000.

## References
- Esri. ArcGIS Maps SDK for JavaScript 5.1, API reference and sample code: https://developers.arcgis.com/javascript/latest/. I adapted the Sketch, Swipe, Feature Table, Histogram Range Slider, Print and ImageryTileLayer (COG) samples and API examples, and the geodetic operator examples. All code in `js/app.js` was written for this project.
- Brown, C.F., et al. (2022). Dynamic World, near real-time global 10 m land use land cover mapping. *Scientific Data*, 9, 251. https://doi.org/10.1038/s41597-022-01307-4
- USDA Forest Service (2025). USFS Tree Canopy Cover v2023.5 (validation only).
- U.S. Geological Survey. Landsat 8/9 Collection 2 Level-2 Surface Temperature.
- CDC/ATSDR (2024). Social Vulnerability Index 2022.
- Dallas Area Rapid Transit. GTFS schedule data: https://www.dart.org/about/about-dart/fixed-route-schedule
- Lanza, K., Ernst, S., Watkins, K., & Chen, B. (2025). Heat stress mitigation by trees and shelters at bus stops. *Transportation Research Part D*, 140, 104653.
- Dzyuban, Y., Hondula, D. M., Coseo, P. J., & Redman, C. L. (2022). Public transit infrastructure and heat perceptions in hot and dry climates. *International Journal of Biometeorology*, 66(2), 345–356.
