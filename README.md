# C21 Online

Consensus21, online. A static site for GitHub Pages where **everything else lives on Nostr**: logins, learner progress, the C21 calendar, weekly videos, portfolios, family messages and payments. There's no server and no database.

## What's in it

| | |
|---|---|
| **Landing page** | Styled like consensus21.school: a spinning 3D cube, animated counters, reveal-on-scroll, a typing terminal and a contribution graph. Shows Kieran's live C21 week and latest video from Nostr. |
| **Lessons** | 37 lessons across 10 programs, all of them things Kieran runs in person: C21 Core (time, money, SIPs, git portfolio), Minecraft Red vs Blue (6 weeks), MakeCode Arcade, VR galleries with A-Frame, how the internet works and Starlink, cyber safety for families, microcontrollers, a Bitcoin and Lightning micro business, websites, and Explorers Day Out. Lessons are free and open to everyone. |
| **Login** | Nostr only: a browser extension (NIP-07), a remote signer like Amber or nsec.app (NIP-46), or a key on this device encrypted with a password (NIP-49). |
| **Parents** | Create learner logins, see each learner's progress, notes, project, calendar and draft repos, download a learning record CSV (mapped to the 8 VRQA learning areas), and switch public portfolios on or off. |
| **Calendar** | Kieran publishes the C21 week as NIP-52 calendar events. Everyone sees it in their own time zone and can export it as .ics. Learners add their own blocks, which are encrypted. |
| **Portfolio** | A GitHub-style profile at `#/u/<npub>`: repositories (NIP-34 announcements, the standard Nostr git tools use), a 12-month contribution graph and Friday devlogs. |
| **Weekly video** | Kieran uploads to a Blossom server, or pastes a link, and publishes a NIP-71 video event to every relay. |
| **Messages** | Encrypted family rooms (NIP-17). A learner's room always includes their parent and Kieran, and learners can't message anyone else. |
| **Payments** | Every plan is paid in sats through Kieran's CLINK offer (`noffer1…`). The learner's wallet gets a Lightning invoice over Nostr, and the page updates when the receipt arrives. |
| **Studio** (Kieran) | Post the weekly video, publish the C21 week, and see every learner who shares progress with a mentor. |

## Safety by design

- **Parents create every learner login.** The learner's key is generated in the parent's browser and locked with a password the parent chooses. The parent keeps an encrypted backup.
- **Learner data is encrypted** (NIP-44, kind 30078) for the learner, their parent and, only if the parent allows it, the mentor. The tag that identifies who a copy is shared with is a hash, so relays can't see family links.
- **There is no public feed, no follows, no zaps and no DMs from strangers.** The site only shows content from Kieran, the logged-in learner and their family.
- **Learners are pseudonymous by default.** They get a generated nickname and a cube avatar, and can't upload photos.
- **Public text is checked** for emails, phone numbers, street addresses, school names, secret keys and swearing before anything is published.
- **Public portfolios are off until a parent switches them on.** Until then, repositories are saved as private drafts the parent can see.

Learner portfolios that a parent makes public are public on Nostr permanently. Tell parents this when they switch it on.

## Go live at learn.consensus21.school

You don't need a command line for any of this.

**1. Put the files on GitHub (about 5 minutes)**
1. On github.com, create a new **public** repository called `c21-online`.
2. On the empty repo page, click **uploading an existing file**. Drag everything from inside the unzipped `c21-pages` folder onto the page, then click **Commit changes**.
3. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. In the same place, type `learn.consensus21.school` under **Custom domain**, then save.

**2. Point the subdomain at GitHub (wherever consensus21.school's DNS is managed)**
Add a DNS record:

| Type | Name | Value |
|---|---|---|
| CNAME | `learn` | `<your-github-username>.github.io` |

Once GitHub shows the domain as verified (usually under an hour), tick **Enforce HTTPS**.

**3. Mirror it onto Nostr (nsite)**
Open learn.consensus21.school, log in with your Kieran npub, go to **Studio** and click **Publish site update**. The site's files are copied to Blossom servers and a signed site record (NIP-5A, kind 35128) goes to the relays. The site is then also live at:

`https://4te82lud6sdrp2an3hl17ex3fkacowjg0rtudne4q384iy2voqc21.nsite.lol`

That copy needs no GitHub at all. Do this again after each update.

The built `assets/app.js` is committed, so GitHub serves the site as is. If you edit anything in `src/`, run `npm run build`, or switch Pages to **GitHub Actions** to use the included workflow, which rebuilds on every push.

## Change things

Edit `src/config.js`, then run `npm install && npm run build`:

- `STAFF_NPUBS`: mentors who can post videos and the calendar. Kieran's npub is already in.
- `RELAYS`: relays used for everything (damus, nos.lol, primal, nostr.mom by default).
- `BLOSSOM_SERVERS`: where weekly videos are uploaded.
- `NOFFER` and `PLANS`: the payment offer and prices in AUD. Prices are converted to sats at the live rate from mempool.space.
- `NOSTRGIT_PROFILE_URL` and `NOSTRGIT_REPO_URL`: where the "View on NostrGit" links go. Set these to NostrGit's real profile and repo URL format, using `{npub}` and `{naddr}`.

Lessons live in `src/lessons.js`. The default week (used until Kieran publishes one) is at the bottom of that file.

For local development, `npm run watch` serves the site at http://localhost:8000.

## How the data fits together

| What | Nostr |
|---|---|
| Login keys | NIP-07, NIP-46, NIP-49 |
| Settings, learner progress, shares | kind 30078, NIP-44 encrypted |
| Family messages, enrolment and payment notices | NIP-17 (kinds 14, 13, 1059) |
| C21 calendar | NIP-52 (kinds 31923 and 31924) |
| Weekly videos | NIP-71 (kind 21) with Blossom uploads |
| Portfolio repositories | NIP-34 (kind 30617) |
| Devlogs | NIP-22 comments (kind 1111) on the repository |
| Payments | CLINK offers (kind 21001) over Nostr |

## Not in this version

- **AI Kieran.** Planned for version 2.
- **Paywalls.** Lessons are free. Plans are paid, but the site doesn't lock features behind a payment. Kieran gets an encrypted payment notice and handles mentoring by hand.
- **Pushing code from the browser.** Learners announce repositories here and push code using NostrGit or ngit, then paste the clone URL.
- **NostrGit compatibility.** Repositories use NIP-34, the shared standard. Check that they show up on nostrgit.xyz, and set the link templates.
