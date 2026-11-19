// Payments over Nostr with CLINK offers (noffer). The payer asks Kieran's offer for a Lightning
// invoice over an encrypted Nostr message, pays it with any wallet, and gets a receipt back.
import { ClinkSDK, decodeBech32 } from '@shocknet/clink-sdk';
import { generateSecretKey } from 'nostr-tools';
import { NOFFER } from './config.js';

export const offer = (() => { const d = decodeBech32(NOFFER); if (d.type !== 'noffer') throw new Error('Bad noffer in config'); return d.data; })();

let rateCache = null;
export async function audPerBtc() {
  if (rateCache && Date.now() - rateCache.t < 5 * 60_000) return rateCache.aud;
  const r = await fetch('https://mempool.space/api/v1/prices').then((x) => x.json());
  rateCache = { t: Date.now(), aud: r.AUD };
  return r.AUD;
}
export async function audToSats(aud) {
  const rate = await audPerBtc();
  return Math.ceil((aud / rate) * 100_000_000);
}

export async function requestInvoice(amountSats, description, onPaid) {
  const sdk = new ClinkSDK({ privateKey: generateSecretKey(), relays: [offer.relay], toPubKey: offer.pubkey, defaultTimeoutSeconds: 30 });
  const res = await sdk.Noffer({ offer: offer.offer, amount_sats: amountSats, description: description.slice(0, 100) }, (receipt) => onPaid?.(receipt), 30);
  if (!res || !('bolt11' in res)) throw new Error(res?.error || 'The offer did not return an invoice. Try again in a minute.');
  return res.bolt11;
}
