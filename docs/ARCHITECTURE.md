# Architecture

## Current

React + TypeScript + Vite, Tailwind CSS 4, shadcn/Radix primitives, Recharts, Lucide SVG, locally served fonts. Dependencies are pinned in package.json and package-lock.json. No runtime secrets are needed for this frontend.

- `src/App.tsx`: page composition, local view/filter/dialog state
- `src/components/ui/`: adapted shadcn base components
- `src/components/performance-charts.tsx`: lazy-loaded Recharts views
- `src/components/number-ticker.tsx`: limited Magic UI adaptation
- `src/lib/report.ts`: formatting, comparisons, periods and report generation
- `src/lib/demo.ts`: explicitly synthetic fixtures, not an API fallback
- `src/index.css`: shared semantic theme tokens and responsive styles
- `tests/`: Chromium workflow and aggregation-boundary checks

## Real Meta integration still needed

### Single Instagram login backend prepared

`worker/` implements official Instagram Login with `instagram_business_basic`, a one-username/one-ID connection, AES-GCM encrypted D1 credentials, HTTP-only same-origin sessions, CSRF protection, disconnect/deletion and daily long-token maintenance. `wrangler.example.jsonc` is a template, not an active deployment. `npm run build:worker` produces a same-origin frontend for Workers; the normal Pages build deliberately disables API requests because GitHub Pages cannot run this backend.

The user's site login requirement is Instagram only. It does not request Facebook Login. Basic Instagram login does not grant paid advertising insights access. A separate authorized Marketing API source is still required for advertising spend and campaign reporting. Await the user's advertising setup and account details; do not silently replace the requested paid-ad workflow with organic profile insights.

Local worker tests use real emulated Workers/D1 and fake Instagram responses. They do not prove real app approval or real account authorization. Actual Workers hosting credentials, Instagram app configuration and owner approval are not present yet. Free service tiers are mandatory; see COST_POLICY.md.

A production service must add official Meta OAuth and server-side credential storage, account selection, Instagram publisher-platform filtering, persisted period aggregates and detailed insights, and an hourly server scheduler. Period/account/granularity/breakdown keys must be updated rather than appended when refetching the same period. Reach must come from the corresponding period-level query; it must not be added across daily or ad rows. The same objective’s spend and results determine cost per result.

The frontend currently models Korean reporting periods. Before a real account is enabled, use its time zone, currency, attribution configuration and a supported API granularity for the identical prior-week cutoff; do not silently equate daily-only snapshots with a partial-day comparison.

Verify Instagram placement, exact period, attribution and timezone against Ads Manager after authentication. Show unconnected, failed refresh with last successful data, and genuine zero separately. None of these backend operations or live data comparisons has been validated by the current frontend tests.

## Decisions

A single Vite frontend is sufficient for the current homepage scope. Whole Next.js/Expo/FastAPI templates are not mixed into it. Tremor’s charting role is covered by Recharts, so a second chart framework is not installed. Extra agents, authenticated MCP services and external UI generation services are not needed to render the page. Do not commit secrets or collect them through the demo modal. Publication and remote push remain user-controlled.
