import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

describe('build output', () => {
  it('produces the user script with Tampermonkey metadata', () => {
    expect(existsSync(distPath)).toBe(true);
    const built = readFileSync(distPath, 'utf8');
    expect(built).toMatch(/==UserScript==/);
    expect(built).toMatch(/@name\s+Genit Memory Helper/);
    expect(built).toMatch(/@version\s+1\.0\.0/);
    expect(built).toContain('Object.defineProperty');
    expect(built).toContain('const GMH = {');
  });
});
