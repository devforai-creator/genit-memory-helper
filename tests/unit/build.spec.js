import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');
const betaDistPath = path.join(repoRoot, 'dist', 'genit-memory-helper.beta.user.js');
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
  });

  it('produces the beta user script with beta UI flag enabled', () => {
    expect(existsSync(betaDistPath)).toBe(true);
    const built = readFileSync(betaDistPath, 'utf8');
    expect(built).toMatch(/@name\s+Genit Memory Helper \(Beta\)/);
    const headerMatch = built.match(/@version\s+([^\n]+)/);
    const scriptMatch = built.match(/const SCRIPT_VERSION = '([^']+)'/);
    expect(headerMatch).toBeTruthy();
    expect(scriptMatch).toBeTruthy();
    const headerVersion = headerMatch?.[1];
    const scriptVersion = scriptMatch?.[1];
    expect(headerVersion).toBe(scriptVersion);
    expect(headerVersion).toMatch(/beta/i);
    expect(built).toMatch(/localStorage\.setItem\('gmh_flag_newUI', '1'\)/);
  });
});
