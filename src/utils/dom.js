export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const triggerDownload = (blob, filename) => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

export const isScrollable = (element) => {
  if (!element) return false;
  if (element === document.body || element === document.documentElement) {
    const target = element === document.body ? document.documentElement : element;
    return target.scrollHeight > target.clientHeight + 4;
  }
  if (!(element instanceof Element)) return false;
  const styles = getComputedStyle(element);
  const overflowY = styles.overflowY;
  const scrollableStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  return scrollableStyle && element.scrollHeight > element.clientHeight + 4;
};

export default {
  sleep,
  triggerDownload,
  isScrollable,
};
