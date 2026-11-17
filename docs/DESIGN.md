# JB Golf workspace design

The supplied [Apple reference](../DESIGN.md) guides the site. A compact black navigation bar, a white context strip and a centered content column accompany the original JB Academy shield. The surface is #f5f5f7, cards are white with 18px corners, body text is #1d1d1f, and controls use #0066cc with a #0071e3 focus outline. System fonts and locally hosted Korean type keep text readable without external font requests. Status colors keep their delivery or warning meaning.

Give mobile and desktop users the same data and actions for their access level. Use wrapping, local scrolling or expandable navigation so that narrow screens can reach every item.

## Content calendar

The public calendar shows dates and schedules with text labels and distinct colors for brands and branches. Staff select JB골프클럽, JB아카데미 or 하우스 오브 제이비 when creating a schedule. Club schedules also require 청담 or 서현. Published posts can appear as date context. The separate Instagram collection groups posts and reels across the three approved accounts and provides links to the original content, public search and account setup. Private schedule notes and customer details require a registered staff browser.

## Inquiry list

PC and mobile use one table with the same column headings, ordering, counts and one row per inquiry. On smaller screens the table scrolls horizontally inside its panel. Customer details and editing are available in the staff view.

## States and data

- Submission view: reviewed KPI cards/headline/caution are temporarily off. Period options and history rows come only from actual stored, nonempty, date-confirmed snapshots; no generated month/week placeholders. Unknown-date cumulative records remain available as one cumulative option. The summary and per-ad photos/figures lead the page.
- The published performance dashboard now reads reviewed screenshot data from D1: no upload page or local archive. Real values, source labels, per-ad post links, and persistent month/7-day history are shown in the existing dashboard. Unknown capture periods remain a separate cumulative view; never turn the ad schedule into a reporting period or invent daily charts. The demo keeps its separate original Monday-based fixture; real reviewed history uses the user's calendar-month slots. Details: [reviewed reporting](REVIEWED_PERFORMANCE.md).
- Default: “Instagram 계정 미연결”, target account @jbgolfacademy, em dashes and helpful empty states. Missing data is never presented as zero.
- Demo: explicitly marked “예시 데이터 · 실제 광고 실적 아님”; copied reports and exported CSV carry the same notice.
- Zero denominator: show absolute change without a percentage; no results means no cost per result.
- Reach is a period-specific unique value, never a sum of daily or ad reach.
- Different result types are never summed. Cost per result uses only the spend for that same objective.
- Fixed demo cutoff is 2026-11-05 14:00 Asia/Seoul. Weekly comparison is 11/02–11/05 versus 10/26–10/29 at the same cutoff.

## Interaction and accessibility

The manual Insight Archive menu, page and entry banner were removed at the user's request on 2026-11-06. The old `#records` URL opens the overview. Previously stored browser records are not automatically erased.

Lucide SVG icons, semantic buttons/links, visible focus, Radix dialog keyboard handling, labels for inputs and filters, accessible table alternatives for both charts, distinct solid/dashed weekly series. Disable nonessential motion with prefers-reduced-motion. Mobile navigation and controls retain accessible names.

Only the main metric numbers use the adapted Magic UI effect. Chart entrance animations are disabled so values remain immediately available. Do not add decorative animation to work-reporting data.

## Sources applied

- UI/UX Pro Max: dashboard/chart choice, focus, empty states, responsive layout and reduced motion.
- Vibe UX frontend-ui-engineering: shared tokens, composable components, realistic Korean states, separate data and presentation.
- bear2u/my-skills frontend-design: specific golf visual identity, typographic hierarchy and restrained visual detail.
- shadcn/ui: actual Button, Card, Badge, Dialog and Tabs source adapted to this project.
- shadcn-admin: responsive dashboard organization as a reference; its app/router/auth were not imported.

Reviewed screenshot data can be real while Meta login/automatic collection remain unconfigured. Status labels must distinguish these states. The fallback/demo overview must never imply live authentication or collection.
