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

// CLINK offer (Lightning over Nostr) for when subscriptions open. Not used yet: the amount is still to be announced.
// src/pay.js still has the invoice helpers for that.
export const NOFFER = 'noffer1qqsyu3ru4svu7na6q79dmxcyyk2u4ya6mrg9th3e2tv6nw96xhve74spz4mhxue69uhhyetvv9ujucm0d9hx7uewd9hsyzm6v9c97er9vesh2mr5qvqsyv9gdue';

export const SITE = {
  name: 'C21 Online',
  tagline: 'Education, rewritten as open source. Now online.',
  campus: 'Campus 01, Mount Martha VIC',
  timezone: 'Australia/Melbourne',
};
