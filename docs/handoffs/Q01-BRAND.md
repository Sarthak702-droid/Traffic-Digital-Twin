# RoadFlow identity and Figma design

Product name: **RoadFlow**, pronounced “Road Flow”. Descriptor: traffic simulation workspace.

Figma: https://www.figma.com/design/XoVyjfoDpC0RN4K1FnsLf7

- Identity board: node 2:27; vector logo component: 2:26.
- Editable desktop emergency design: 2:72, using native text, frames, instances and vectors. No full-screen image fills. Design specimen values are explicitly illustrative, not acceptance evidence.
- Button states: 2:59 (default, hover, loading, disabled); request-state specimens: 2:48.
- Scoped color variables bind the design to the existing app palette. Font validation returned Inter for all screen text. Full-screen and identity previews were visually inspected; graph labels and palette placements corrected.
- Exported the Figma logo with SVG_STRING into apps/web/public/brand/roadflow-mark.svg. ProductBrand places it in sidebar and header, with decorative image semantics and a readable product name. SVG also serves as the favicon; browser title and footer use RoadFlow.
- Actual recorded/model quality, operator identity, physical-control prohibition and existing request loading remain unchanged.

Validation: all 141 web tests pass; TypeScript check and Vite build pass. Existing >500 kB bundle advisory remains. Browser verified both SVG images loaded (40px sidebar, 32px header) and the RoadFlow page title. Live preview: http://127.0.0.1:3102/?view=emergency.

Evidence previews: /tmp/roadflow-figma-workspace.png, /tmp/roadflow-figma-brand.png, /tmp/roadflow-live-brand.png. Local Figma workflow ledger: /tmp/design-system-state-roadflow.json.

This change supplies a Figma design and integrates the identity; the Figma specimen does not replace runtime state with illustrative values. Engineering prototype gate statuses are unchanged. GitHub publication still awaits the earlier requested authorization.
