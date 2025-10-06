export const looksLikeName = (raw) => {
  const value = String(raw ?? '')
    .replace(/^[\-•\s]+/, '')
    .trim();
  if (!value) return false;
  if (/^(INFO|메시지 이미지)$/i.test(value)) return false;
  return /^[가-힣A-Za-z][\w가-힣 .,'’]{0,24}$/.test(value);
};

export const luhnValid = (value) => {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = parseInt(digits[i], 10);
    if (Number.isNaN(digit)) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
};

const resolvePath = (object, path) => {
  if (!path) return object;
  const segments = path.split('.');
  let cursor = object;
  for (const segment of segments) {
    if (cursor == null) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
};

export const requireDeps = (deps = {}, requirements = {}) => {
  const entries = Object.entries(requirements);
  entries.forEach(([path, validator]) => {
    const check = typeof validator === 'function' ? validator : () => true;
    const value = resolvePath(deps, path);
    if (!check(value)) {
      throw new Error(`[GMH] Missing or invalid dependency: ${path}`);
    }
  });
  return deps;
};

export default {
  looksLikeName,
  luhnValid,
  requireDeps,
};
