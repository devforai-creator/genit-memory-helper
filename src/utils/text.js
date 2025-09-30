export const normNL = (value) => String(value ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n');

export const stripTicks = (value) => String(value ?? '').replace(/```+/g, '');

export const collapseSpaces = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

export const stripQuotes = (value) =>
  String(value ?? '')
    .replace(/^['"“”『「《【]+/, '')
    .replace(/['"“”』」》】]+$/, '')
    .trim();

export const stripBrackets = (value) => String(value ?? '').replace(/^\[|\]$/g, '').trim();

export const sanitizeText = (value) =>
  collapseSpaces(normNL(value).replace(/[\t\v\f\u00a0\u200b]/g, ' '));

export const parseListInput = (raw) => {
  if (!raw) return [];
  return normNL(raw)
    .split(/[,\n]/)
    .map((item) => collapseSpaces(item))
    .filter(Boolean);
};

export default {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
  parseListInput,
};
