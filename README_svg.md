# SVG-Based Level Authoring for a Top-Down Scroller

This README collects the recommendations from our discussion about using **Inkscape**, **SVG**, and **JPG backgrounds** for a top-down scroller.

## 1. Clean, Minimal SVGs from Inkscape

Yes, Inkscape can produce clean SVGs without Inkscape-specific tags.

### Inkscape SVG vs Plain SVG
- **Inkscape SVG** keeps extra `inkscape:` and `sodipodi:` metadata.
- Those tags help preserve editability in Inkscape.
- **Plain SVG** removes most editor-specific metadata and is better for shipping, embedding, and cleaner diffs.

### Recommended export workflow
Keep two versions:

1. **Editable source**: save as **Inkscape SVG**
2. **Delivery/export**: save or export as **Plain SVG**

### Useful cleanup steps before export
Before exporting, clean up the document where practical:
- remove Inkscape-specific data
- remove proprietary SVG data
- remove unused definitions
- optionally remove transforms if you want simpler markup

### Best practice
Treat the native Inkscape file as your source and the plain/optimized SVG as build output.

### CLI example
```bash
inkscape --export-plain-svg=out.svg in.svg
```

### Practical export recipe
```text
edit in Inkscape SVG
→ run cleanup actions
→ export Plain SVG
→ optimize with Scour/SVGO
```

## 2. Using SVG as a Level/Scene Format

Using SVG as a scene format for a top-down scroller is a strong idea, with one important refinement:

**Use SVG as the authoring format, but not necessarily as the final runtime format.**

### Why SVG works well for level authoring
- gameplay objects can be placed visually
- coordinates line up with the art
- hidden layers can define collisions, spawn points, triggers, refill stations, paths, and camera zones
- the same file can describe both visuals and layout

### What to avoid
Do not depend too heavily on Inkscape-specific or proprietary tags for game semantics.

That creates tight coupling between the editor and your game logic.

### Better approach
Use normal SVG structure plus custom data attributes:
- IDs
- labels
- hidden layers
- `data-*` attributes

Example:

```xml
<g id="gameplay" style="display:none">
  <circle
    id="health_01"
    cx="320"
    cy="640"
    r="24"
    data-kind="health_station"
    data-heal="100"
    data-respawn="8" />

  <rect
    id="spawn_player"
    x="64"
    y="128"
    width="32"
    height="32"
    data-kind="spawn"
    data-entity="player" />

  <path
    id="wall_01"
    d="M 0,0 L 300,0 L 300,40 L 0,40 Z"
    data-kind="collision" />
</g>
```

### Why this is better than proprietary tags
- easier to parse
- easier to validate
- less likely to break during cleanup/export
- portable to other tools
- readable in version control
- not tied to Inkscape forever

## 3. Recommended Pipeline

A strong pipeline for your game would be:

1. Draw the map in Inkscape
2. Put gameplay helpers on dedicated hidden layers
3. Tag them with `data-*` attributes or strict naming conventions
4. Save/export as SVG
5. Run a converter that:
   - reads the SVG
   - extracts gameplay objects
   - simplifies/compiles collision if needed
   - writes `level.json`
   - optionally rasterizes the art layer if your engine does not render SVG directly

### Suggested layer structure
- `art_bg`
- `art_fg`
- `collision`
- `spawn`
- `interactables`
- `triggers`
- `paths`
- `occluders`

### Authoring rules that help a lot
- use simple shapes for gameplay data: circles, rects, paths
- keep gameplay markers invisible or on hidden/non-export layers
- give every gameplay node a unique `id`
- avoid encoding gameplay meaning only in fill colors
- validate the SVG during the build step so mistakes fail early

## 4. Using a JPG as the Background

Using a JPG as the background image is a good and practical choice.

### Best when the background is
- painted or textured
- static
- full-bleed
- not dependent on transparency
- not intended for infinite scaling without quality loss

### Good hybrid setup
- **SVG** for level authoring and gameplay markers
- **JPG or WebP** for the painted background art
- **JSON or similar** for extracted runtime gameplay data

### Why this works well
It lets you:
- visually author the map in a vector editor
- avoid rendering a heavy SVG directly in-game
- keep gameplay semantics separate from visual art

### Downsides of JPG
JPG is usually a poor choice for:
- sharp UI-like edges
- text
- pixel art
- crisp geometric shapes
- transparency
- seam-sensitive tiled imagery

In those cases, PNG or lossless WebP is usually better.

### Rule of thumb
- use **JPG** for painted terrain, lighting, dirt, foliage, ruins, and textured scenes
- use **PNG/WebP** for transparent overlays, sharp details, or lossless needs
- do **not** use JPG for collision or gameplay marker data

### Practical visual/runtime split
A very solid setup is:
- `background.jpg` for base art
- optional `foreground.png` for details drawn above the player
- `level.svg` as the editable authoring source
- `level.json` as compiled runtime gameplay data

## 5. Embedding a JPG Inside an SVG

Yes, a JPG can be embedded into an SVG.

SVG supports raster images through the `<image>` element.

### Linked external image
```xml
<image x="0" y="0" width="1024" height="1024" href="background.jpg" />
```

### Embedded image as base64
```xml
<image x="0" y="0" width="1024" height="1024"
       href="data:image/jpeg;base64,..." />
```

### When embedding is useful
Embedding is useful when you want:
- one self-contained scene file
- easy transport
- no missing relative asset paths

### Tradeoffs of embedding
- the SVG file becomes much larger
- version-control diffs become ugly
- changing the background rewrites a huge data blob
- parsing/loading can be less convenient

### Recommendation
- **For authoring**: embedding can be convenient
- **For runtime/build output**: keeping the JPG separate is usually cleaner

### Inkscape-specific note
When importing an image into Inkscape, you can typically choose:
- **embed**
- **link**

A good compromise is:
- embed the JPG in the editable source only if you really want a single-file authoring asset
- keep the runtime background as a separate image file

## 6. Overall Recommendation

For your top-down scroller, the strongest architecture is:

- use **Inkscape SVG** as the editable source
- use **Plain SVG** or optimized SVG for cleaner exported assets when needed
- use **SVG** to author geometry and gameplay markers
- use **custom attributes** such as `data-kind="health_station"` instead of relying on proprietary editor tags
- use a **build step** to convert the SVG into runtime data such as `level.json`
- use **JPG/WebP/PNG** for flattened visual background layers
- optionally embed raster backgrounds inside SVG during authoring, but avoid depending on that for runtime unless you specifically want a single-file scene format

## 7. Short Version

If you want the simplest robust workflow:

```text
Inkscape SVG = editable source
Plain SVG = cleaned export
SVG = authoring format for markers and layout
JPG/PNG/WebP = visual background assets
JSON = runtime gameplay data
```

That gives you a pipeline that is:
- easy to author
- portable
- engine-friendly
- clean in source control
- not locked to Inkscape-specific metadata
