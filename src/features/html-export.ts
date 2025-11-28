/**
 * HTML Export Feature
 * Exports conversation as standalone HTML with embedded images
 */

interface StructuredSnapshotMessagePart {
  speaker?: string | null;
  role?: string | null;
  flavor?: string | null;
  type?: string | null;
  text?: string | null;
  lines?: string[];
  src?: string | null;
  alt?: string | null;
  [key: string]: unknown;
}

interface StructuredSnapshotMessage {
  id?: string | null;
  speaker?: string | null;
  role?: string | null;
  channel?: string | null;
  parts?: StructuredSnapshotMessagePart[];
  [key: string]: unknown;
}

interface StructuredSnapshot {
  messages: StructuredSnapshotMessage[];
  legacyLines?: string[];
  generatedAt?: number;
  [key: string]: unknown;
}

interface ImageCaptureResult {
  success: boolean;
  originalUrl: string;
  dataUrl?: string;
  error?: string;
  dimensions?: { width: number; height: number };
}

interface HtmlExportOptions {
  title?: string;
  includeImages?: boolean;
  inlineStyles?: boolean;
  maxImageWidth?: number;
}

interface HtmlExportResult {
  success: boolean;
  html?: string;
  stats?: {
    totalImages: number;
    capturedImages: number;
    failedImages: number;
    htmlSize: number;
  };
  error?: string;
}

interface HtmlExportDependencies {
  documentRef?: Document;
  getActiveAdapter?: () => { findContainer?: (doc: Document) => Element | null } | null;
  logger?: { log?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void } | null;
}

/**
 * Convert an image URL to base64 data URL using canvas
 */
export async function captureImageAsBase64(
  imageUrl: string,
  options: { maxWidth?: number; timeout?: number } = {},
): Promise<ImageCaptureResult> {
  const { maxWidth = 1200, timeout = 10000 } = options;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeoutId = setTimeout(() => {
      resolve({
        success: false,
        originalUrl: imageUrl,
        error: 'Image load timeout',
      });
    }, timeout);

    img.onload = () => {
      clearTimeout(timeoutId);
      try {
        // Calculate dimensions (respect maxWidth while maintaining aspect ratio)
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = maxWidth;
          height = Math.round(height * ratio);
        }

        // Create canvas and draw image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({
            success: false,
            originalUrl: imageUrl,
            error: 'Failed to get canvas context',
          });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/webp', 0.85);

        resolve({
          success: true,
          originalUrl: imageUrl,
          dataUrl,
          dimensions: { width, height },
        });
      } catch (err) {
        resolve({
          success: false,
          originalUrl: imageUrl,
          error: err instanceof Error ? err.message : 'Canvas conversion failed',
        });
      }
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        originalUrl: imageUrl,
        error: 'Failed to load image (CORS or network error)',
      });
    };

    img.src = imageUrl;
  });
}

/**
 * Extract Cloudflare proxy URL to get the parameters
 */
export function parseCloudflareImageUrl(url: string): {
  isCloudflare: boolean;
  originalUrl?: string;
  params?: Record<string, string>;
} {
  // Pattern: https://domain/cdn-cgi/image/{params}/{originalUrl}
  const cfPattern = /^(https?:\/\/[^/]+)\/cdn-cgi\/image\/([^/]+)\/(.+)$/;
  const match = url.match(cfPattern);

  if (!match) {
    return { isCloudflare: false };
  }

  const paramString = match[2];
  const originalUrl = match[3];

  // Parse params like "width=1044,format=auto,quality=85"
  const params: Record<string, string> = {};
  paramString.split(',').forEach((pair) => {
    const [key, value] = pair.split('=');
    if (key && value) {
      params[key] = value;
    }
  });

  return {
    isCloudflare: true,
    originalUrl,
    params,
  };
}

/**
 * Test image capture capability (for PoC debugging)
 */
export async function testImageCapture(
  imageUrl?: string,
  doc: Document = document,
): Promise<ImageCaptureResult[]> {
  const results: ImageCaptureResult[] = [];

  // If no URL provided, find images in the page
  const urls: string[] = [];
  if (imageUrl) {
    urls.push(imageUrl);
  } else {
    // Find character/content images (not UI icons)
    const images = doc.querySelectorAll<HTMLImageElement>('img[src*="blob.babechat"], img[src*="cdn-cgi/image"]');
    images.forEach((img) => {
      if (img.src && !urls.includes(img.src)) {
        urls.push(img.src);
      }
    });

    // Limit to first 5 for testing
    urls.splice(5);
  }

  if (urls.length === 0) {
    return [
      {
        success: false,
        originalUrl: '',
        error: 'No images found to test',
      },
    ];
  }

  // Test each image
  for (const url of urls) {
    const result = await captureImageAsBase64(url);
    results.push(result);

    // Log progress
    const status = result.success ? '✅' : '❌';
    const info = result.success
      ? `${result.dimensions?.width}x${result.dimensions?.height}`
      : result.error;
    console.log(`[GMH] Image capture ${status}: ${info}`);
    console.log(`  URL: ${url.substring(0, 80)}...`);
  }

  return results;
}

/**
 * Collect all images from conversation container
 */
function collectConversationImages(container: Element): HTMLImageElement[] {
  const images: HTMLImageElement[] = [];
  const imgElements = container.querySelectorAll<HTMLImageElement>('img');

  imgElements.forEach((img) => {
    // Skip tiny images (likely icons/avatars)
    if (img.naturalWidth < 50 && img.naturalHeight < 50) {
      return;
    }
    // Skip SVG placeholders
    if (img.src.startsWith('data:image/svg')) {
      return;
    }
    images.push(img);
  });

  return images;
}

/**
 * Clean up react-medium-image-zoom artifacts from cloned content
 * This library adds wrapper divs and ghost elements that cause image cropping
 */
function cleanupZoomLibraryArtifacts(container: Element): void {
  // Remove ghost elements (used for zoom button positioning)
  const ghosts = container.querySelectorAll('[data-rmiz-ghost]');
  ghosts.forEach((ghost) => ghost.remove());

  // Remove zoom buttons
  const zoomBtns = container.querySelectorAll('[data-rmiz-btn-zoom], [data-rmiz-btn-unzoom]');
  zoomBtns.forEach((btn) => btn.remove());

  // Unwrap images from zoom wrapper divs
  const zoomWrappers = container.querySelectorAll('[data-rmiz]');
  zoomWrappers.forEach((wrapper) => {
    const img = wrapper.querySelector('img');
    if (img && wrapper.parentNode) {
      // Move image out of zoom wrapper
      wrapper.parentNode.insertBefore(img, wrapper);
      wrapper.remove();
    }
  });

  // Also clean up [data-rmiz-content] wrappers
  const contentWrappers = container.querySelectorAll('[data-rmiz-content]');
  contentWrappers.forEach((wrapper) => {
    const img = wrapper.querySelector('img');
    if (img && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(img, wrapper);
      wrapper.remove();
    }
  });

  // Remove aria-owns attributes that reference zoom modals
  const ariaOwns = container.querySelectorAll('[aria-owns^="rmiz-"]');
  ariaOwns.forEach((el) => el.removeAttribute('aria-owns'));
}

/**
 * Clone element with computed styles inlined
 */
function cloneWithInlineStyles(element: Element, doc: Document): Element {
  const clone = element.cloneNode(true) as Element;

  // Clean up zoom library artifacts first
  cleanupZoomLibraryArtifacts(clone);

  // Remove overflow:hidden from scroll containers and relax max-width constraints
  const scrollContainers = clone.querySelectorAll('[class*="overflow-hidden"], [class*="max-w-"]');
  scrollContainers.forEach((el) => {
    if (el instanceof HTMLElement) {
      el.style.overflow = 'visible';
      el.style.maxWidth = 'none';
    }
  });

  // Get all elements including the root (after cleanup)
  const originalElements = [element, ...Array.from(element.querySelectorAll('*'))];
  const clonedElements = [clone, ...Array.from(clone.querySelectorAll('*'))];

  // Essential style properties to preserve
  const styleProps = [
    'display',
    'flex-direction',
    'align-items',
    'justify-content',
    'gap',
    'padding',
    'margin',
    'width',
    'max-width',
    'height',
    'background-color',
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'text-align',
    'border',
    'border-radius',
    'box-shadow',
    'overflow',
    'white-space',
    'word-break',
  ];

  // Properties to skip for image containers (to prevent cropping)
  const imageContainerSkipProps = ['overflow', 'height', 'max-height'];

  for (let i = 0; i < originalElements.length && i < clonedElements.length; i++) {
    const original = originalElements[i];
    const cloned = clonedElements[i];

    if (!(original instanceof HTMLElement) || !(cloned instanceof HTMLElement)) {
      continue;
    }

    // Check if this element contains an image (is an image container)
    const containsImage = original.querySelector('img') !== null;
    const isImage = original.tagName === 'IMG';

    try {
      const computed = doc.defaultView?.getComputedStyle(original);
      if (!computed) continue;

      const inlineStyles: string[] = [];
      for (const prop of styleProps) {
        // Skip certain properties for image containers to prevent cropping
        if (containsImage && imageContainerSkipProps.includes(prop)) {
          continue;
        }

        const value = computed.getPropertyValue(prop);
        if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
          inlineStyles.push(`${prop}: ${value}`);
        }
      }

      if (inlineStyles.length > 0) {
        cloned.style.cssText = inlineStyles.join('; ');
      }

      // Special handling for images - ensure they display fully
      if (isImage) {
        cloned.style.cssText = 'max-width: 100%; height: auto; object-fit: contain;';
      }
    } catch {
      // Skip elements that can't be styled
    }
  }

  return clone;
}

/**
 * Generate standalone HTML document
 */
export async function exportAsHtml(
  deps: HtmlExportDependencies,
  options: HtmlExportOptions = {},
): Promise<HtmlExportResult> {
  const {
    title = 'Conversation Export',
    includeImages = true,
    inlineStyles = true,
    maxImageWidth = 800,
  } = options;

  const doc = deps.documentRef ?? document;
  const logger = deps.logger ?? console;

  try {
    // Get conversation container
    const adapter = deps.getActiveAdapter?.();
    const container = adapter?.findContainer?.(doc);

    if (!container) {
      return {
        success: false,
        error: 'Conversation container not found',
      };
    }

    // Clone the container
    let clonedContent: Element;
    if (inlineStyles) {
      clonedContent = cloneWithInlineStyles(container, doc);
    } else {
      clonedContent = container.cloneNode(true) as Element;
    }

    // Process images
    let totalImages = 0;
    let capturedImages = 0;
    let failedImages = 0;

    if (includeImages) {
      const images = clonedContent.querySelectorAll<HTMLImageElement>('img');
      totalImages = images.length;

      for (const img of Array.from(images)) {
        if (!img.src || img.src.startsWith('data:')) {
          continue;
        }

        // Skip small images (icons/avatars)
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width < 50 && height < 50) {
          continue;
        }

        logger.log?.(`[GMH] Capturing image: ${img.src.substring(0, 60)}...`);

        const result = await captureImageAsBase64(img.src, { maxWidth: maxImageWidth });

        if (result.success && result.dataUrl) {
          img.src = result.dataUrl;
          img.removeAttribute('srcset');
          img.removeAttribute('loading');
          capturedImages++;
        } else {
          // Keep original URL but mark as failed
          img.setAttribute('data-capture-failed', result.error || 'unknown');
          failedImages++;
        }
      }
    }

    // Build HTML document
    const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="General Memory Helper">
  <meta name="exported-at" content="${new Date().toISOString()}">
  <title>${escapeHtml(title)}</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #1a1a1a;
      color: #e0e0e0;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }
    .export-header {
      text-align: center;
      padding: 20px;
      margin-bottom: 20px;
      border-bottom: 1px solid #333;
    }
    .export-header h1 {
      margin: 0 0 10px;
      font-size: 1.5em;
    }
    .export-header p {
      margin: 0;
      color: #888;
      font-size: 0.9em;
    }
    .conversation-content {
      background: #242424;
      border-radius: 12px;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="export-header">
    <h1>${escapeHtml(title)}</h1>
    <p>Exported by General Memory Helper on ${new Date().toLocaleString('ko-KR')}</p>
    <p>Images: ${capturedImages}/${totalImages} captured${failedImages > 0 ? ` (${failedImages} failed)` : ''}</p>
  </div>
  <div class="conversation-content">
    ${clonedContent.innerHTML}
  </div>
</body>
</html>`;

    return {
      success: true,
      html: htmlContent,
      stats: {
        totalImages,
        capturedImages,
        failedImages,
        htmlSize: htmlContent.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Export failed',
    };
  }
}

/**
 * Export HTML from structured snapshot data (for virtual scrolling sites)
 */
export async function exportFromStructuredData(
  snapshot: StructuredSnapshot,
  options: {
    title?: string;
    includeImages?: boolean;
    maxImageWidth?: number;
    logger?: { log?: (...args: unknown[]) => void } | null;
  } = {},
): Promise<HtmlExportResult> {
  const {
    title = 'Conversation Export',
    includeImages = true,
    maxImageWidth = 800,
    logger = console,
  } = options;

  try {
    const messages = snapshot.messages || [];
    if (messages.length === 0) {
      return { success: false, error: 'No messages in snapshot' };
    }

    // Collect all image URLs from parts
    const imageUrls = new Set<string>();
    messages.forEach((msg) => {
      msg.parts?.forEach((part) => {
        if (part.type === 'image' && part.src) {
          imageUrls.add(part.src);
        }
      });
    });

    // Capture images as base64
    const imageMap = new Map<string, string>();
    let capturedImages = 0;
    let failedImages = 0;

    if (includeImages) {
      for (const url of imageUrls) {
        logger?.log?.(`[GMH] Capturing image: ${url.substring(0, 60)}...`);
        const result = await captureImageAsBase64(url, { maxWidth: maxImageWidth });
        if (result.success && result.dataUrl) {
          imageMap.set(url, result.dataUrl);
          capturedImages++;
        } else {
          failedImages++;
        }
      }
    }

    // Generate HTML for each message
    const messageHtmls = messages.map((msg) => {
      const role = msg.role || 'unknown';
      const speaker = msg.speaker || '';
      const channel = msg.channel || '';

      const isPlayer = role === 'player' || channel === 'user';
      const bubbleClass = isPlayer ? 'message-player' : 'message-npc';

      // Render parts
      const partsHtml = (msg.parts || [])
        .map((part) => {
          if (part.type === 'image' && part.src) {
            const src = imageMap.get(part.src) || part.src;
            return `<img src="${escapeHtml(src)}" alt="${escapeHtml(part.alt || '')}" class="message-image" />`;
          }
          if (part.type === 'text' || part.type === 'dialogue' || part.type === 'narration') {
            const text = part.text || part.lines?.join('\n') || '';
            const partSpeaker = part.speaker ? `<span class="part-speaker">${escapeHtml(part.speaker)}</span>` : '';
            const flavor = part.flavor || part.type || '';
            return `<div class="message-part ${flavor}">${partSpeaker}${escapeHtml(text)}</div>`;
          }
          if (part.lines && part.lines.length > 0) {
            return `<div class="message-part">${part.lines.map((l) => escapeHtml(l)).join('<br>')}</div>`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');

      const speakerHtml = speaker ? `<div class="message-speaker">${escapeHtml(speaker)}</div>` : '';

      return `
        <div class="message ${bubbleClass}">
          ${speakerHtml}
          <div class="message-content">
            ${partsHtml}
          </div>
        </div>
      `;
    }).join('\n');

    const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="General Memory Helper">
  <meta name="exported-at" content="${new Date().toISOString()}">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #1a1a1a;
      color: #e0e0e0;
    }
    .export-header {
      text-align: center;
      padding: 20px;
      margin-bottom: 20px;
      border-bottom: 1px solid #333;
    }
    .export-header h1 { margin: 0 0 10px; font-size: 1.5em; }
    .export-header p { margin: 5px 0; color: #888; font-size: 0.9em; }
    .conversation { display: flex; flex-direction: column; gap: 16px; }
    .message {
      max-width: 80%;
      padding: 12px 16px;
      border-radius: 12px;
      white-space: pre-wrap;
    }
    .message-player {
      align-self: flex-end;
      background: #2563eb;
      border-bottom-right-radius: 4px;
    }
    .message-npc {
      align-self: flex-start;
      background: #262727;
      border-bottom-left-radius: 4px;
    }
    .message-speaker {
      font-weight: bold;
      font-size: 0.85em;
      margin-bottom: 4px;
      opacity: 0.8;
    }
    .message-content { }
    .message-part { margin: 4px 0; }
    .message-part.narration { color: #a0a0a0; font-style: italic; }
    .message-part.dialogue { }
    .part-speaker { font-weight: bold; margin-right: 8px; }
    .message-image {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 8px 0;
      display: block;
    }
  </style>
</head>
<body>
  <div class="export-header">
    <h1>${escapeHtml(title)}</h1>
    <p>Exported by General Memory Helper on ${new Date().toLocaleString('ko-KR')}</p>
    <p>Messages: ${messages.length} | Images: ${capturedImages}/${imageUrls.size} captured${failedImages > 0 ? ` (${failedImages} failed)` : ''}</p>
  </div>
  <div class="conversation">
    ${messageHtmls}
  </div>
</body>
</html>`;

    return {
      success: true,
      html: htmlContent,
      stats: {
        totalImages: imageUrls.size,
        capturedImages,
        failedImages,
        htmlSize: htmlContent.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Export failed',
    };
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Create downloadable HTML file
 */
export function downloadHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';

  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export default {
  captureImageAsBase64,
  parseCloudflareImageUrl,
  testImageCapture,
  exportAsHtml,
  exportFromStructuredData,
  downloadHtml,
};
