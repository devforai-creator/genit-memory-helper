import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');
const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../../package.json');

describe('build output', () => {
  it('produces the user script with Tampermonkey metadata', () => {
    expect(existsSync(distPath)).toBe(true);
    const built = readFileSync(distPath, 'utf8');
    expect(built).toMatch(/==UserScript==/);
    expect(built).toMatch(/@name\s+Genit Memory Helper/);
    const versionPattern = new RegExp(`@version\\s+${packageVersion.replaceAll('.', '\\.')}`);
    expect(built).toMatch(versionPattern);
    expect(built).toContain('Object.defineProperty');
    expect(built).toContain('const GMH = {');
    expect(built).toMatch(/gmh_kill/);
    expect(built).not.toMatch(/gmh_flag_newUI/);
  });
});
