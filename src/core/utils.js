export const clone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return value;
  }
};

export const deepMerge = (target, patch) => {
  const base = Array.isArray(target) ? [...target] : { ...target };
  if (!patch || typeof patch !== 'object') return base;
  Object.entries(patch).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current =
        base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? base[key] : {};
      base[key] = deepMerge(current, value);
    } else {
      base[key] = value;
    }
  });
  return base;
};

export default {
  clone,
  deepMerge,
};
