export const looksLikeName = (raw: unknown): boolean => {
  const value = String(raw ?? '')
    .replace(/^[\-•\s]+/, '')
    .trim();
  if (!value) return false;
  if (/^(INFO|메시지 이미지)$/i.test(value)) return false;
  return /^[가-힣A-Za-z][\w가-힣 .,'’]{0,24}$/.test(value);
};

export const luhnValid = (value: unknown): boolean => {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const digit = parseInt(digits[i] ?? '', 10);
    if (Number.isNaN(digit)) return false;
    let nextDigit = digit;
    if (shouldDouble) {
      nextDigit *= 2;
      if (nextDigit > 9) nextDigit -= 9;
    }
    sum += nextDigit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
};

type RequirementValidator = (value: unknown) => boolean;

type RequirementMap = Record<string, RequirementValidator | null | undefined>;

const isIndexable = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const resolvePath = (object: unknown, path: string | null | undefined): unknown => {
  if (!path) return object;
  const segments = path.split('.');
  let cursor: unknown = object;
  for (const segment of segments) {
    if (!isIndexable(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
};

export const requireDeps = <T extends Record<string, unknown>>(
  deps: T,
  requirements: RequirementMap = {},
): T => {
  const entries = Object.entries(requirements);
  entries.forEach(([path, validator]) => {
    const check: RequirementValidator =
      typeof validator === 'function' ? validator : () => true;
    const value = resolvePath(deps, path);
    if (!check(value)) {
      throw new Error(`[GMH] Missing or invalid dependency: ${path}`);
    }
  });
  return deps;
};

const validationUtils = {
  looksLikeName,
  luhnValid,
  requireDeps,
} as const;

export default validationUtils;
