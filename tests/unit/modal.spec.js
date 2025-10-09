import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

import { createModal } from '../../src/ui/modal.ts';

describe('UI modal sanitization', () => {
  let modal;
  let testDocument;
  let testWindow;

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      pretendToBeVisual: true,
      url: 'https://example.com/',
    });
    testWindow = dom.window;
    testWindow.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    testWindow.cancelAnimationFrame = (id) => clearTimeout(id);
    testDocument = testWindow.document;
    modal = createModal({ documentRef: testDocument, windowRef: testWindow });
  });

  afterEach(() => {
    if (modal?.close) modal.close(false);
    const overlay = testDocument?.querySelector('.gmh-modal-overlay');
    overlay?.remove();
    testWindow?.close?.();
  });

  it('removes inline script tags from HTML content', async () => {
    const pending = modal.open({
      title: 'Test',
      content: '<div>Safe</div><script>alert(1)</script>',
      actions: [{ label: 'OK', value: true }],
    });

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    expect(modalBody.innerHTML).toContain('Safe');
    expect(modalBody.innerHTML).not.toContain('<script');

    modal.close(true);
    await pending;
  });

  it('strips event handler attributes', async () => {
    const pending = modal.open({
      title: 'Test',
      content: '<img src="x" onerror="alert(1)">',
      actions: [{ label: 'OK', value: true }],
    });

    const img = testDocument.querySelector('.gmh-modal__body img');
    expect(img?.getAttribute('onerror')).toBeNull();

    modal.close(true);
    await pending;
  });

  it('removes javascript: URLs', async () => {
    const pending = modal.open({
      title: 'Test',
      content: '<a href="javascript:alert(1)">Click</a>',
      actions: [{ label: 'OK', value: true }],
    });

    const link = testDocument.querySelector('.gmh-modal__body a');
    expect(link?.getAttribute('href')).toBeNull();

    modal.close(true);
    await pending;
  });

  it('preserves safe HTML structure', async () => {
    const pending = modal.open({
      title: 'Test',
      content: '<div><p>Paragraph</p><strong>Bold</strong></div>',
      actions: [{ label: 'OK', value: true }],
    });

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    expect(modalBody.querySelector('p')?.textContent).toBe('Paragraph');
    expect(modalBody.querySelector('strong')).toBeTruthy();

    modal.close(true);
    await pending;
  });

  it('preserves multiple sibling nodes when content is sanitized', async () => {
    const pending = modal.open({
      title: 'Test',
      content: '<div>First</div><div>Second</div><div>Third</div>',
      actions: [{ label: 'OK', value: true }],
    });

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    const divs = Array.from(modalBody.children).filter((node) => node.tagName === 'DIV');
    expect(divs).toHaveLength(3);
    expect(divs.map((node) => node.textContent)).toEqual(['First', 'Second', 'Third']);

    modal.close(true);
    await pending;
  });

  it('drops srcdoc attributes from embedded frames', async () => {
    const pending = modal.open({
      title: 'Test',
      content: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      actions: [{ label: 'OK', value: true }],
    });

    const modalBody = testDocument.querySelector('.gmh-modal__body');
    expect(modalBody.querySelector('iframe')).toBeNull();

    modal.close(true);
    await pending;
  });
});
