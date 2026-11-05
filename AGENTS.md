# JB Golf project instructions

- Read README.md, docs/DESIGN.md, docs/COST_POLICY.md and docs/INSTAGRAM_SETUP.md before changing the connection flow.
- User requirement: all website work should stay within free service tiers. Do not opt into paid plans, subscriptions or automatic upgrades. Cloudflare Workers Free + D1 is the proposed connection backend; it has not yet been deployed or authenticated.
- User-facing sign-in must use official Instagram Login, not Facebook Login. Limit the connection to one configured Instagram username and the first verified numeric account ID. Multi-account functionality is deferred.
- Instagram basic login and Marketing API advertising access are separate. A profile connection is not proof of advertising access. Never present mock data or profile login as live paid-ad insights.
- Keep secrets/tokens in server-side secret bindings and encrypted storage. Never request passwords, verification codes or app secrets in chat; never put them into Pages assets, browser storage or commits.
- The existing GitHub Pages deployment must keep working while the connection backend is prepared. Do not redirect users to an unconfigured/nonexistent server or claim live connection success before the owner completes real authorization.
- Use the existing checkout. Do not create Git worktrees unless the user explicitly requests one.
- Validate frontend changes with npm run build and npm test. For authentication changes, also run npm run build:worker and npm run test:worker. The latter uses actual local Workers/D1 with fake external Instagram responses and does not establish live authorization success.
- Deployment records are in docs/DEPLOYMENT.md. Respect current user authorization for pushes/deployment and never force-push over unrelated work.
