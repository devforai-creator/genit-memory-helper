import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../package.json');
const scriptPath = path.join(repoRoot, 'genit-memory-helper.user.js');
const versionPattern = /(\/\/\s*@version\s+)([^\n]+)/;

async function syncVersion() {
  const contents = await readFile(scriptPath, 'utf8');
  const match = contents.match(versionPattern);
  if (!match) {
    throw new Error('Unable to locate @version metadata header in template');
  }
  const updated = contents.replace(versionPattern, (_, prefix, current) => {
    if (current === packageVersion) {
      return `${prefix}${current}`;
    }
    return `${prefix}${packageVersion}`;
  });
  if (updated !== contents) {
    await writeFile(scriptPath, updated, 'utf8');
    console.log('Updated metadata version to %s', packageVersion);
  } else {
    console.log('Metadata version already %s', packageVersion);
  }
}

syncVersion().catch((error) => {
  console.error('[sync-version] failed:', error);
  process.exitCode = 1;
});
