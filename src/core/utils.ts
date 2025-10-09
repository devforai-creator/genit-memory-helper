type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const clone = <T>(value: T): T => {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
};

export const deepMerge = <T extends PlainObject | unknown[]>(
  target: T,
  patch: unknown,
): T => {
  const base: PlainObject | unknown[] = Array.isArray(target)
    ? [...target]
    : { ...(target as PlainObject) };
  if (!patch || typeof patch !== 'object') return base as T;
  Object.entries(patch as PlainObject).forEach(([key, value]) => {
    if (isPlainObject(value)) {
      const current = (base as PlainObject)[key];
      const nextSource = isPlainObject(current) ? current : {};
      (base as PlainObject)[key] = deepMerge(nextSource, value);
    } else {
      (base as PlainObject)[key] = value;
    }
  });
  return base as T;
};

const coreUtils = {
  clone,
  deepMerge,
} as const;

export default coreUtils;
