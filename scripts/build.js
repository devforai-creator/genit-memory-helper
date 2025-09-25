import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const builds = [
  {
    source: 'genit-memory-helper.user.js',
    target: path.join('dist', 'genit-memory-helper.user.js'),
  },
];

async function build() {
  const distDir = path.join(repoRoot, 'dist');
  await mkdir(distDir, { recursive: true });

  for (const { source, target } of builds) {
    const sourcePath = path.join(repoRoot, source);
    const distPath = path.join(repoRoot, target);
    const contents = await readFile(sourcePath, 'utf8');
    await writeFile(distPath, contents, 'utf8');
    console.log('Built %s', path.relative(repoRoot, distPath));
  }
}

build().catch((error) => {
  console.error('[build] failed:', error);
  process.exitCode = 1;
});
