export {};

declare global {
  const unsafeWindow: Window & typeof globalThis;

  const GM_info: {
    script: {
      name: string;
      version: string;
      [key: string]: unknown;
    };
    platform?: string;
    [key: string]: unknown;
  };

  function GM_setClipboard(
    data: string,
    info?:
      | string
      | {
          type?: string;
          mimetype?: string;
        },
  ): void;
}
