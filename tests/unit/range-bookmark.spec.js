import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');
const fixturePath = path.join(repoRoot, 'tests/fixtures/genit_sample.html');

describe('Range bookmark integration', () => {
  it('applies the selected bookmark when setting the start turn', async () => {
    const script = readFileSync(distPath, 'utf8');
    const html = readFileSync(fixturePath, 'utf8');

    const dom = new JSDOM(html, {
      url: 'https://genit.ai/chat',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });

    const { window } = dom;
    window.GM_setClipboard = () => {};
    window.alert = () => {};
    window.confirm = () => true;
    window.requestAnimationFrame = (cb) => {
      cb();
      return 0;
    };
    window.unsafeWindow = window;
    if (!window.MutationObserver) {
      window.MutationObserver = class {
        observe() {}
        disconnect() {}
      };
    }

    window.eval(script);

    const { document, GMH } = window;
    expect(GMH).toBeDefined();

    GMH.UI.mountPanel();
    GMH.Core.MessageIndexer.start();
    GMH.Core.MessageIndexer.refresh({ immediate: true });

    const chatContainer = document.querySelector(
      '[data-testid="chat-container"]',
    );
    expect(chatContainer).not.toBeNull();

    const firstPlayer = chatContainer.querySelector(
      '[data-message-id="msg-1"] .markdown-content',
    );
    firstPlayer.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }),
    );

    const extraBlock = document.createElement('div');
    extraBlock.setAttribute('data-message-id', 'msg-4');
    extraBlock.innerHTML = `
      <article data-role="user" data-username="플레이어">
        <div class="markdown-content text-right">추가 메시지</div>
      </article>
    `;
    chatContainer.appendChild(extraBlock);

    GMH.Core.MessageIndexer.refresh({ immediate: true });

    const secondPlayer = extraBlock.querySelector('.markdown-content');
    secondPlayer.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }),
    );

    const bookmarkSelect = document.querySelector('#gmh-range-bookmark-select');
    expect(bookmarkSelect).not.toBeNull();

    const bookmarkList = GMH.Core.TurnBookmarks.list();
    expect(bookmarkList.length).toBeGreaterThanOrEqual(2);

    const olderEntry = bookmarkList[1];
    expect(olderEntry.ordinal).toBeGreaterThan(0);
    bookmarkSelect.value = olderEntry.key;
    bookmarkSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

    document.querySelector('#gmh-range-mark-start').click();

    const resolveOrdinal = (entry) => {
      if (entry.messageId) {
        const byId = document.querySelector(
          `[data-gmh-message-id="${entry.messageId}"]`,
        );
        if (byId) {
          const value = Number(byId.getAttribute('data-gmh-player-turn'));
          if (Number.isFinite(value)) return value;
        }
      }
      if (Number.isFinite(entry.index)) {
        const byIndex = document.querySelector(
          `[data-gmh-message-index="${entry.index}"]`,
        );
        if (byIndex) {
          const value = Number(byIndex.getAttribute('data-gmh-player-turn'));
          if (Number.isFinite(value)) return value;
        }
      }
      return null;
    };

    const resolvedOrdinal = resolveOrdinal(olderEntry);
    expect(resolvedOrdinal).toBeGreaterThan(0);

    const bounds = GMH.Core.ExportRange.describe();
    expect(bounds.active).toBe(true);
    expect(bounds.start).toBe(resolvedOrdinal);
  });
});
