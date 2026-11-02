// Turns the compact rows dumped from a live Popular search (build/seed-rows.json)
// into src/seed.json, the starter videos shown on a fresh install.
import { readFileSync, writeFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync(new URL('./seed-rows.json', import.meta.url)));
const items = {};
for (const [id, text, name, handle, ava, verified, poster, ar, duration, variants, views, likes, replies, reposts, created] of rows) {
  items[id] = {
    id, text, ar, duration, views, likes, replies, reposts, created, sensitive: false,
    author: { name, handle, avatar: 'https://pbs.twimg.com/profile_images/' + ava, verified: !!verified },
    poster: 'https://pbs.twimg.com/' + poster,
    variants: variants.map(([u, bitrate, w, h]) => ({ url: 'https://video.twimg.com/' + u, bitrate, w, h })),
  };
}
const ids = Object.keys(items);
writeFileSync(new URL('../src/seed.json', import.meta.url), JSON.stringify({ v: 1, seed: true, feeds: { foryou: ids, popular: ids }, items }) + '\n');
console.log('seed:', ids.length, 'videos');
