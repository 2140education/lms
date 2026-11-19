## What changed

Each learner now has an encrypted **circle**: the learner, their parents and their guide. Only the circle can read the learner's portfolio, calendar, progress and messages.

- **Private git portfolio** ([src/portfolio.js](src/portfolio.js)), laid out like a consensus21.school profile: Overview, Projects, My week, Journal, SIPs, pinned repos, core program bars and a contribution heatmap. Repos have Code, Commits and Feedback pages.
  - Repos, commits and feedback use the NIP-34 kinds (30617, 1617, 1111) inside NIP-59 gift wraps, sealed once per circle member. Relays only see ciphertext.
  - Commit ids are SHA-256 hashes chained to the previous commit, re-checked in the viewer's browser.
  - Attachments are AES-256-GCM encrypted in the browser before upload to Blossom.
- **Private calendar**: NIP-52 kind 31923 events inside gift wraps, which anyone in the circle can add. Week and month views, .ics export.
- **Family keys and circles**: parents create (or link) a key pair per child, choose the guide (Kieran or any npub) and add co-parents by npub. Adding a member re-seals the learner's history for them.
- **Guide role**: a Learners page; guides can read portfolios, give feedback and add 1:1s.
- **No public learner profiles** (no kind 0 for children). The relay list is now ten widely used free relays.
- **Landing page**: the "Your profile is your report card" roster now matches consensus21.school and links to made-up example learners.

## Why

This follows the Consensus21 white paper (Nostr identity, self-managed calendars, git portfolios), but keeps children's work private to their family and guide instead of publishing it.

## For reviewers

- Tested end to end on a local relay: guide → parent → learner commits → parent/guide read and comment → outsider locked out → co-parent added later sees full history. **Not yet tested on the live public relays.**
- Public repos announced before this change are no longer shown. The old public-portfolio toggle is gone.
- Standard git and ngit can't read gift-wrapped repos, so portfolios are edited in the browser.
- The council multisig, SIP voting and the 18th-birthday timelock from the white paper are not built.
- `assets/app.js` is rebuilt and committed, as before.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
