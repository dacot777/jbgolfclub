# JB Golf dashboard design

## Direction

A quiet, refined golf editorial language applied to a work dashboard. The page leads with the weekly report, then spend/reach/impressions/clicks, comparable weekly trends, monthly totals and objective-specific details. The dark forest-green sidebar and report panel retain the existing published draft’s visual identity.

UI/UX Pro Max searches returned a relevant **Data-Dense Dashboard** style and **Trend Over Time / Line Chart** guidance. Its generated enterprise sales landing pattern was off-topic even after a narrower retry; it was not adopted or saved as a verified product pattern. The following is a project-specific synthesis of the verified chart/accessibility guidance and existing JB Golf palette.

## Semantic tokens

| Role | Value |
| --- | --- |
| background | #f6f7f4 |
| surface | #ffffff |
| foreground | #27372d |
| primary | #204f3d |
| sidebar / report | #173e30 |
| accent | #d2ed9e |
| muted foreground | #66746b |
| border | #e3e8df |
| current chart line | #315f45 |
| previous chart line | #7b8a7e, dashed |
| monthly spend bar | #7f9965 |

Typography uses locally served DM Sans Variable and Noto Sans KR Variable with tabular figures. Korean paragraphs retain natural wrapping. Font licenses are included. Component spacing follows a 4/8px rhythm; primary cards use 10–13px radii and restrained shadows.

## States and data

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
