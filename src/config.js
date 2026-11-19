// ===== C21 Online settings. Edit these, then run `npm run build`. =====

// Kieran (and any other mentors). These keys can post weekly videos and the C21 calendar,
// and see learners who share their progress with a mentor.
export const STAFF_NPUBS = globalThis.C21_TEST_STAFF || [
  'npub1cyla8qgt9gv8y6ydv8s2prt89h8afc0sr2kaz64ryjmlpdrzxm4qwlh53q', // Kieran
];

// The most widely used free public relays. Everything is published to all of them, so there's
// no single point of failure. Private data is always encrypted before it leaves the browser:
// relays only ever see ciphertext (NIP-44) and gift wraps from throwaway keys (NIP-59).
export const RELAYS = globalThis.C21_TEST_RELAYS || [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://relay.nostr.net',
  'wss://nostr.oxtr.dev',
  'wss://nostr.bitcoiner.social',
  'wss://relay.coinos.io',
];

// Extra relays used only to find public profiles (kind 0) of parents and guides.
export const PROFILE_RELAYS = globalThis.C21_TEST_RELAYS ? [] : ['wss://purplepag.es', 'wss://user.kindpag.es'];

// Largest file (bytes) a learner can commit as text. Gift wraps are NIP-44 encrypted twice,
// which caps a single event at about 64 KB, so bigger files go to Blossom as encrypted blobs.
export const MAX_TEXT_COMMIT = 36_000;

// Blossom servers for weekly video uploads and encrypted portfolio attachments (tried in order).
export const BLOSSOM_SERVERS = ['https://blossom.primal.net', 'https://blossom.band'];

// All payments go to this CLINK offer (Lightning over Nostr).
export const NOFFER = 'noffer1qqsyu3ru4svu7na6q79dmxcyyk2u4ya6mrg9th3e2tv6nw96xhve74spz4mhxue69uhhyetvv9ujucm0d9hx7uewd9hsyzm6v9c97er9vesh2mr5qvqsyv9gdue';

// Prices in Australian dollars. Converted to sats at today's rate when paying.
export const PLANS = [
  { id: 'explorer', name: 'Explorer', aud: 29, per: 'month', blurb: 'Every lesson, your calendar, your portfolio, weekly videos from Kieran.', features: ['All lessons and projects', 'Personal C21 calendar', 'Encrypted git portfolio', 'Parent dashboard'] },
  { id: 'studio', name: 'Studio', aud: 149, per: 'month', blurb: 'Explorer plus live cohort sessions and mentor feedback on your projects.', features: ['Everything in Explorer', 'Two live sessions a week', 'Mentor feedback on your repo', 'Kieran as your guide'], featured: true },
  { id: 'founder', name: 'Founder', aud: 399, per: 'month', blurb: 'Studio plus a weekly 1:1 with a mentor to take your project to launch.', features: ['Everything in Studio', 'Weekly 1:1 mentoring', 'Launch and pitch support'] },
  { id: 'holiday', name: 'Holiday Studio day', aud: 1000, per: 'day', blurb: 'In person at Campus 01, Mount Martha, in the school holidays.', features: ['9:00am to 3:00pm', 'Explorers Day Out', 'Max 21 learners'] },
];

export const SITE = {
  name: 'C21 Online',
  tagline: 'School, rewritten as open source. Now online.',
  campus: 'Campus 01, Mount Martha VIC',
  timezone: 'Australia/Melbourne',
};
