import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data/about.json');
const org = 'beetlebox-studios';

async function readme(repo) {
  const headers = { Accept: 'application/vnd.github.raw+json' };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${org}/${repo}/readme`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const rule = lines.findIndex((l) => /^---\s*$/.test(l));
  const head = (rule === -1 ? lines : lines.slice(0, rule)).join('\n');
  const pitch = head
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('<') && !p.startsWith('!['));
  const start = lines.findIndex((l) => /^##\s+About\s*$/i.test(l));
  let about;
  if (start !== -1) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^#{1,2}\s/.test(l));
    about = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim() || undefined;
  }
  return { pitch, about };
}

const games = JSON.parse(readFileSync(join(root, 'data/games.json'), 'utf8'));
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const result = {};

for (const game of games) {
  if (!game.repo) continue;
  try {
    const text = await readme(game.repo);
    if (text === null) {
      console.warn(`${game.title}: no README visible in ${game.repo}`);
      if (previous[game.title]) result[game.title] = previous[game.title];
      continue;
    }
    const { pitch, about } = parse(text);
    if (!pitch && !about) continue;
    result[game.title] = { repo: game.repo, ...(pitch && { pitch }), ...(about && { about }) };
  } catch (e) {
    console.warn(`${game.title}: ${e.message}, keeping what was there`);
    if (previous[game.title]) result[game.title] = previous[game.title];
  }
}

writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`about.json: ${Object.keys(result).length} games`);
