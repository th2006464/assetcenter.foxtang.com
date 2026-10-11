# Administrator Asset Management Implementation Plan

> **For agentic workers:** Execute with superpowers:executing-plans in this session.

**Goal:** Ship administrator-only passwordless imports and precise record editing/deletion, retaining user read behavior and live Agent ingestion.
**Architecture:** Shared verified-email roles, double enforcement in Pages/AMS, exact source references across reconciliation, D1 atomic writes with audit.
**Tech Stack:** Native JavaScript, Cloudflare Pages/Workers/D1, jose, Node tests.
**Spec:** ../specs/2026-10-11-admin-assets-design.md

## Global Constraints
- Administrator: th2006464@gmail.com. Never trust browser role claims.
- Serial number and computer name are immutable. Agent /report remains identical to live backup.
- Hard delete permits recreation through later report/import. No production mutations during tests.

## Review Focus
- Ordinary identity with Import Key must not bypass roles.
- Merged legacy serials and duplicated names must target only exact underlying records.
- Changed original computer name must reject stale writes.
- Invalid/unknown fields or numeric values must reject before any writes.
- Audit/database failure must roll back all writes; frontend errors remain visible.

### Task 1: Identity and ingestion safety
Files: backend/access.js, functions/session.js, functions/api/[[path]].js, backend/ams.js, configs, tests/admin-*.test.mjs.
- [x] Add role and access-route denial tests; characterize live /report with real SQLite. Observe failures.
- [x] Implement shared role lookup and enriched session, enforce imports in Pages/AMS. Preserve live /report.
- [x] Run tests.

### Task 2: Exact record management
Files: backend/admin.js, backend/migrations/0001_admin_audit.sql, backend/ams.js, js/common.js, tests/admin-records.test.mjs.
- [x] Test key immutability, exact deletion/edit, SQL safety, recreation, conflict, audit rollback. Observe failures.
- [x] Add source refs to device queries/reconciliation and implement POST detail, PATCH edit, DELETE records with atomic audits.
- [x] Run tests.

### Task 3: Frontend and verification
Files: js/admin.js, js/app.js, devices.html, css/style.css, scripts/build.mjs, README.md, tests/admin-ui.test.mjs.
- [x] Test hidden user controls and passwordless administrator import before implementation.
- [x] Add administrator operations, read-only matching keys, per-source editing and deletion confirmation.
- [x] Update stale filter expectations to existing baseline behavior and freeze only live /report.
- [x] Run full suite, builds, UI checks, independent review and inspect diff.

## Execution ledger
- User explicitly authorized implementation of the discussed design; proceed without repeating approval. Work on codex/admin-asset-management in the existing checkout; baseline backups already protect the original.
- Live ingestion differs from repository: preserve backed-up live block, including VPN version.

- Pre-release verification: full suite, Pages compile, AMS dry-run passed. Browser synthetic UI verified administrator save, passwordless CSV import, and ordinary-user hidden controls. No production mutation/deployment performed.
- Review: fixed D1 row byte limit by UTF-8 grouped audit rows and JSON bulk imports; added repeat-import boundary tests. Fixed empty/multiline value preservation. Full-row snapshot guards now reject concurrent changes before commit to keep logs accurate.
- Existing stale tests corrected to the baseline default Agent-only view, with additional unreported-view coverage. The old combined ingestion/import hash was obsolete; replaced with exact live-ingestion hash plus real ingestion SQL behavior.

## Production release
- Audit migration applied successfully without modifying existing source records. AMS version: `71ee8f95-e81b-444f-9a31-b5bec5aa8752`. Pages deployment: `77a5fb79-4df0-4516-9531-be2e504113d8`, source commit `ce76763`.
- Fresh pre-deployment backup: `assetcenter-baseline-backups/20261011-083019-pre-admin-deploy`; live Worker unchanged from original baseline before deployment.
- Post-deployment Worker /report block compared byte-for-byte to original production. Administrator vars verified in both services, prior AMS secret names retained.
- Production counts verified: devices 255, asset_inventory 449, admin_audit 0. No real asset record was changed or deleted for acceptance.
- Production checks: anonymous /session 200 with authenticated false; private page 302 to login; AMS /devices, admin PATCH and uncredentialed /report all 401. Three deployed JS files match local source hashes.
- Browser-integrity protection rejected default Python urllib headers (1010); normal browser and browser-style HTTP requests verified behavior. No Cloudflare security setting changed.
- Real Google/Access administrator and ordinary-user account acceptance remains for signed-in users. Synthetic signed JWT tests and browser fixture checks do not replace real-account acceptance.
- Source available in draft PR #1; main is not merged. Production was deployed directly from the verified feature commit.
