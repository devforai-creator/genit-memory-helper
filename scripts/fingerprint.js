import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TARGET = process.env.GENIT_HOME_URL || 'https://genit.ai/';

async function fetchHtml(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function extractAssetFingerprints(html) {
  const regex = /<(?:script|link)[^>]+?(?:src|href)="([^"]+)"/g;
  const matches = [];
  let m;
  while ((m = regex.exec(html))) {
    const asset = m[1];
    if (/\.(?:js|css)(?:\?|$)/.test(asset)) {
      matches.push(asset);
    }
  }
  return matches.sort();
}

function fingerprint(assets) {
  const hash = crypto.createHash('sha256');
  for (const asset of assets) {
    hash.update(asset);
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function main() {
  const html = await fetchHtml(TARGET);
  const assets = extractAssetFingerprints(html);
  const fp = fingerprint(assets);

  console.log('ASSET_FP=' + fp);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outPath = path.join(__dirname, '..', 'dist', 'asset-fingerprint.txt');
  await writeFile(outPath, `url=${TARGET}\nassets=${assets.length}\nASSET_FP=${fp}\n`, 'utf8');
}

main().catch((error) => {
  console.error('[fingerprint] failed:', error);
  process.exitCode = 1;
});
