# Ambulance corridor visualization redesign

Figma: https://www.figma.com/design/XoVyjfoDpC0RN4K1FnsLf7?node-id=2-72

Updated the editable emergency screen with ordered route-stop cards, modeled ETAs, signal labels, an aggregate-map legend and a progress disclosure. Route-stop component: 6:16. Figma preview visually checked; all text uses Inter and no whole-screen image fills exist.

Implemented EmergencySimulation as the emergency map card in Workspace. The card includes live lifecycle stage, virtual clock, configured route/control counts, selectable route stops, actual signal indications/countdowns, available modeled ETAs, aggregate stock legend and virtual-safety context. It preserves the existing NetworkCanvas and junction inspector; designated road tracks have stronger contrast without changing stock coloring, signal indications or motion semantics. The route strip scrolls within its container on narrow screens.

Data remains authoritative: active emergency route comes from the frame; idle route comes from configuration. Unrelated scenarios expose no emergency ETAs or signals in the route strip. Boundary route points explicitly have no configured signal. No ambulance-position animation, fabricated travel gain or individual-vehicle simulation was introduced.

Regression-first: new component suite initially failed because the component was absent. Three passing regressions cover live route/status and selection, suppression of emergency progress in a different scenario, and a configured route containing a third controlled junction.

Validation: 144 web tests, TypeScript check, production build and diff checks pass. Existing build chunk-size advisory remains. Browser verified route card C3 opens the real junction inspector; 390px viewport has 375px document width and intentional route-strip overflow only. Restored default viewport. Evidence: /tmp/roadflow-ambulance-live.png and /tmp/roadflow-ambulance-figma.png.

No backend/contracts or prototype acceptance-gate claims changed. Local commit only; previous GitHub-push authorization is still pending.
