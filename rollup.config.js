import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const metaBanner = `// ==UserScript==\n`
  + `// @name         Genit Memory Helper\n`
  + `// @namespace    local.dev\n`
  + `// @version      ${packageJson.version}\n`
  + `// @description  Genit 대화로그 JSON/TXT/MD 추출 + 요약/재요약 프롬프트 복사 기능\n`
  + `// @author       devforai-creator\n`
  + `// @match        https://genit.ai/*\n`
  + `// @match        https://www.genit.ai/*\n`
  + `// @grant        GM_setClipboard\n`
  + `// @run-at       document-idle\n`
  + `// @updateURL    https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js\n`
  + `// @downloadURL  https://github.com/devforai-creator/genit-memory-helper/raw/main/genit-memory-helper.user.js\n`
  + `// @license      GPL-3.0-or-later\n`
  + `// ==/UserScript==\n`;

export default {
  input: 'src/index.js',
  output: {
    file: 'genit-memory-helper.user.js',
    format: 'iife',
    name: 'GMHBundle',
    banner: metaBanner,
  },
  plugins: [
    resolve(),
    typescript({
      tsconfig: './tsconfig.build.json',
      include: ['src/**/*.ts'],
    }),
  ],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
  },
};
