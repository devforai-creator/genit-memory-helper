import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function build() {
  const sourcePath = path.join(repoRoot, 'genit-memory-helper.user.js');
  const distDir = path.join(repoRoot, 'dist');
  const distPath = path.join(distDir, 'genit-memory-helper.user.js');

  const source = await readFile(sourcePath, 'utf8');
  await mkdir(distDir, { recursive: true });
  await writeFile(distPath, source, 'utf8');

  console.log('Built %s', path.relative(repoRoot, distPath));
}

build().catch((error) => {
  console.error('[build] failed:', error);
  process.exitCode = 1;
});
