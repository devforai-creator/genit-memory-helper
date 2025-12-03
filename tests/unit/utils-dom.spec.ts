import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { sleep, triggerDownload, isScrollable } from '../../src/utils/dom';

describe('utils/dom', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://example.com',
      pretendToBeVisual: true,
    });
    globalThis.window = dom.window as unknown as typeof window;
    globalThis.document = dom.window.document;
    globalThis.Element = dom.window.Element;
    // ensure getComputedStyle is available on globalThis for spies
    // @ts-expect-error augment global
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sleep resolves after duration', async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const promise = sleep(100).then(spy);
    vi.advanceTimersByTime(99);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await promise;
    expect(spy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('triggerDownload clicks a generated link and revokes the URL', () => {
    const click = vi.fn();
    const anchor = {
      click,
      _href: '',
      _download: '',
      set href(value: string) {
        this._href = value;
      },
      get href() {
        return this._href;
      },
      set download(value: string) {
        this._download = value;
      },
      get download() {
        return this._download;
      },
    } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    triggerDownload(new Blob(['test']), 'file.txt');

    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:url');
  });

  it('isScrollable handles null, body, and element overflow checks', () => {
    expect(isScrollable(null)).toBe(false);

    // Body branch uses documentElement metrics
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 200, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 100, configurable: true });
    expect(isScrollable(document.body)).toBe(true);

    // Element branch uses getComputedStyle
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { value: 150, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({ overflowY: 'auto' } as any);
    expect(isScrollable(el)).toBe(true);

    vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({ overflowY: 'hidden' } as any);
    expect(isScrollable(el)).toBe(false);
  });
});
