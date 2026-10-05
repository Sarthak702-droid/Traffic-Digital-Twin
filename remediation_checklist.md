# Traffic Digital Twin Remediation Checklist

## P0 - Critical
- [x] 01. Control benefit benchmark failed (CONTROL/EVIDENCE)
- [x] 02. Pending approved plan survives manual takeover / new lock (SAFETY/CONTROL)
- [x] 03. Manual decision resolution can settle without proven simulator outcome (SAFETY/AUDIT)
- [x] 04. Idempotency key can be omitted/malformed and mutation still executes (SECURITY/RELIABILITY)
- [x] 06. Forecast availability time is filtered against finalized-window end (FORECAST/DATA QUALITY)
- [x] 07. Delivery dashboard evidence handler permits path traversal (SECURITY)
- [x] 17. Reference-quality claims are emitted without independent review (EVIDENCE/DATA QUALITY)

## P1 - High
- [x] 05. Command identity is not strongly bound to method + route + body (SECURITY)
- [x] 08. Departing-direction count semantics can be wrong/mislabeled (DATA QUALITY/VISION)
- [x] 09. Decode failure can be treated as clean EOF / complete processing (DATA QUALITY)
- [x] 10. Queue estimator is pixel/sample-rate dependent (VISION/DATA QUALITY)
- [x] 11. Rollout can replace known unreleased demand with forecast rates (FORECAST/MODEL)
- [x] 12. Compare path bypasses shared admission/concurrency controls (RELIABILITY/CONTROL)
- [x] 13. Established WebSocket does not recheck expiry/revocation (SECURITY)
- [x] 14. Old flow can remain displayed after evidence coverage ends (UI/EVIDENCE)
- [ ] 15. Mean headway / individual passage reconstruction is not defensible (DATA QUALITY)
- [ ] 16. Tracking IDs/trails persisted despite aggregate-only privacy claim (PRIVACY/EVIDENCE)
- [ ] 20. Fresh installation path does not fully cover vision dependencies (OPERATIONS)

## P2 - Medium
- [ ] 18. Presentation paths retain 12-camera / two-junction / C1-C3 assumptions (UI/CONFIG)
- [ ] 19. Completion/readiness messaging can contradict open acceptance (EVIDENCE/OPERATIONS)
