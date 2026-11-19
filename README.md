# C21 Online

Consensus21, online, following the [Consensus21 white paper](https://consensus21.school/). A static site where **everything else lives on Nostr**: logins, learner progress, calendars, weekly videos, git portfolios, and family messages. There's no server and no database, and everything personal is encrypted before it leaves the browser.

## What's in it

| | |
|---|---|
| **Landing page** | Styled like the Consensus21 site: a spinning 3D cube, animated counters, a typing terminal, and the same "Your profile is your report card" learner roster, linking to example learners. |
| **Login** | Nostr key pairs only: a browser extension (NIP-07), a remote signer like Amber or nsec.app (NIP-46), or a key on this device encrypted with a password (NIP-49). |
| **Family keys** | A parent creates a key pair for each child in their own browser (or links a key the child already has), locked with a password the parent chooses. The Family page lists every key in the family. |
| **Circles** | Each learner has a circle: the learner, their parents (co-parents can be added by npub) and their guide. Only the circle can read the learner's portfolio, calendar, progress and messages. |
| **Guides** | Anyone can sign up as a guide. A parent picks Kieran or pastes another guide's npub. Guides see their learners, read portfolios, give feedback and add 1:1s to calendars. |
| **Lessons** | Problem-based learning: 49 lessons across 12 programs. Every program starts with a driving question and follows the same project cycle (meet the problem, investigate, plan, build, test, share, reflect). "Start here" teaches the cycle itself, and a guides-and-parents program shows how to design a unit around a real problem and assess it through the portfolio. Marking a lesson done can commit your notes to your portfolio. |
| **Calendar** | Week and month views. The public C21 week (NIP-52, from Kieran) plus the learner's own weekly blocks and private events. Anyone in the circle can add an event. Exports to .ics. |
| **Portfolio** | Laid out like a Consensus21 profile (Overview, Projects, My week, Journal, SIPs) at `#/u/<npub>`. Backed by private git on Nostr: repositories, commits, files, a contribution graph, Explorers Days, Friday reflections and SIPs, plus feedback from parents and guide. |
| **Forms** | Built on [Formstr](https://about.formstr.app/) (NIP-101). Parents, guides and Kieran build forms from C21 templates (Friday check-in, Explorers Day debrief, SIP feedback, lesson check, parent survey), send them to learners' circles and read the answers, which are encrypted to the form's key. Learners can save a copy of their answers to their portfolio. Every form also opens in formstr.app, and Formstr forms can be imported. Kieran can put a public "Register interest" form on the home page. |
| **Weekly video** | Kieran uploads to a Blossom server, or pastes a link, and publishes a NIP-71 video event. |
| **Messages** | Encrypted circle rooms (NIP-17). Learners can only message their own circle. |
| **Pricing** | One subscription, the same for everyone, paid in sats over Lightning. 10% of every payment goes into a bitcoin timelock that opens when the learner turns 18, as the white paper describes. The amount isn't announced yet, so there's no checkout. |
| **Studio** (Kieran) | Post the weekly video, publish the C21 week and mirror the site to Nostr (nsite). |

## How encryption works

- **Private git portfolio.** Repositories (kind 30617), commits (kind 1617) and feedback (kind 1111) use the NIP-34 kinds, but every one is a NIP-59 *gift wrap*: a rumor sealed and signed by its author, then wrapped by a throwaway key, once for each person in the circle. Relays see only ciphertext, a random timestamp and the recipient. They can't tell who wrote it, what kind it is, or that it's a portfolio at all.
- **Verifiable history.** Each commit id is a SHA-256 of its parent, message, changes and time, so the history is a chain like git. The viewer's browser re-checks every id, and the seal signature proves the learner wrote it.
- **Encrypted attachments.** Photos and other files are AES-256-GCM encrypted in the browser, then uploaded to Blossom. The key lives only inside the encrypted commit.
- **Private calendar.** Events are NIP-52 kind 31923 inside gift wraps. Removing an event publishes a cancelled version.
- **Progress and settings.** NIP-44 encrypted kind 30078, with a separate copy for each circle member. The tag that names a copy is a hash, so relays can't see family links.
- **Changing the circle.** When a parent adds a co-parent or a new guide, the app re-seals the learner's history (and the parent's own events) for the new person, so they see everything from the start. Removing someone stops future sharing, but can't take back what they already read.

- **Forms.** Each Formstr form has its own key. Learner forms are private: the questions are encrypted to a view key that only travels inside encrypted messages to the circle, and the name tag is left blank. Answers are encrypted to the form's key, so only its owner can read them. A response does show publicly that a given pubkey answered a given form address; learners have no public profile, so that pubkey isn't linked to a name.

The public C21 week and the weekly videos are deliberately public: they're the shared timetable and announcements, not anyone's personal data.

## Safety by design

- **Parents create every learner key.** The key is generated in the parent's browser and locked with a password the parent chooses. The parent keeps an encrypted backup.
- **Nothing public about a child.** Learners never publish a profile (kind 0). No names, photos or follower counts. They get a generated nickname and a blocky pixel-art character.
- **A circle of three.** Only the learner, their parents and their guide can read their work or message them. There's no public feed and no DMs from strangers.
- **No secret keys in portfolios.** Commits are checked for nsec/ncryptsec keys and seed phrases.

## Go live at lms.2140education.org

The site is served by GitHub Pages from [2140education/lms](https://github.com/2140education/lms). The `CNAME` file in the repo already holds the domain.

**1. Turn on Pages**
In the repo, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save. Check that **Custom domain** shows `lms.2140education.org`.

**2. Point the subdomain at GitHub (wherever 2140education.org's DNS is managed)**
Add a DNS record:

| Type | Name | Value |
|---|---|---|
| CNAME | `lms` | `2140education.github.io` |

Once GitHub shows the domain as verified (usually under an hour), tick **Enforce HTTPS**.

**3. Mirror it onto Nostr (nsite)**
Open lms.2140education.org, log in with your Kieran npub, go to **Studio** and click **Publish site update**. The site's files are copied to Blossom servers and a signed site record (NIP-5A, kind 35128) goes to the relays. The site is then also live at:

`https://4te82lud6sdrp2an3hl17ex3fkacowjg0rtudne4q384iy2voqc21.nsite.lol`

That copy needs no GitHub at all. Do this again after each update.

The built `assets/app.js` is committed, so GitHub serves the site as is. The page is `index.html`, so it loads at the root URL. If you edit anything in `src/`, run `npm run build`, or switch Pages to **GitHub Actions** to use the included workflow, which rebuilds on every push.

## Change things

Edit `src/config.js`, then run `npm install && npm run build`:

- `STAFF_NPUBS`: mentors who can post videos and the calendar. Kieran's npub is already in, and he is the default guide.
- `RELAYS`: the public relays everything is published to (ten widely used free relays by default).
- `BLOSSOM_SERVERS`: where weekly videos are uploaded.
- `NOFFER`: the CLINK payment offer, kept for when subscriptions open (not used yet; helpers in `src/pay.js`).
- `MAX_TEXT_COMMIT`: the largest text commit (gift wraps cap a single event at about 64 KB). Bigger files go to Blossom as encrypted uploads.

Lessons live in `src/lessons.js`. Each program has a `problem` (its driving question) and each lesson a `phase` from `PBL_CYCLE`. The default week (used until Kieran publishes one) is at the bottom of that file.

For local development, `npm run watch` serves the site at http://localhost:8000. To test without touching public relays, set `globalThis.C21_TEST_RELAYS = ['ws://127.0.0.1:7777']` in a script tag before `assets/app.js` and run any local relay.

## How the data fits together

| What | Nostr |
|---|---|
| Login keys | NIP-07, NIP-46, NIP-49 |
| Settings, learner progress, shares | kind 30078, NIP-44 encrypted |
| Portfolio repos, commits, feedback | NIP-34 kinds 30617, 1617, 1111, inside NIP-59 gift wraps |
| Private calendar events | NIP-52 kind 31923, inside NIP-59 gift wraps |
| Portfolio attachments | AES-GCM encrypted blobs on Blossom |
| Circle messages, enrolment, co-parent links, form assignments | NIP-17 (kinds 14, 13, 1059) |
| Forms | Formstr / NIP-101: template kind 30168 (signed by a per-form key, spec NIP-44 encrypted to a view key), responses kind 1069 (NIP-44 encrypted to the form key), the owner's form list kind 14083, access grants kind 18 in gift wraps to alias keys |
| Home page interest form pointer | kind 30078 `c21/interest-form`, public |
| C21 learning week | NIP-52 (kinds 31923 and 31924), public |
| Weekly videos | NIP-71 (kind 21) with Blossom uploads, public |

## Not in this version

- **AI Kieran.** Planned for version 2.
- **Payments.** There's one subscription for everyone, but the amount isn't announced yet, so there's no checkout. Nothing is locked behind a payment.
- **Pushing with git or ngit.** Portfolios are edited in the browser. Standard git tools can't read gift-wrapped repositories yet, so there's no `git push` to a private portfolio.
- **Multisig council, SIP voting and the 18th-birthday timelock** from the white paper. The 3-of-6 council wallet and timelock aren't automated.
