export const normNL = (value: unknown): string =>
  String(value ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n');

export const stripTicks = (value: unknown): string => String(value ?? '').replace(/```+/g, '');

export const collapseSpaces = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

export const stripQuotes = (value: unknown): string =>
  String(value ?? '')
    .replace(/^['"“”『「《【]+/, '')
    .replace(/['"“”』」》】]+$/, '')
    .trim();

export const stripBrackets = (value: unknown): string =>
  String(value ?? '').replace(/^\[|\]$/g, '').trim();

export const sanitizeText = (value: unknown): string =>
  collapseSpaces(normNL(value).replace(/[\t\v\f\u00a0\u200b]/g, ' '));

export const parseListInput = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  return normNL(raw)
    .split(/[,\n]/)
    .map((item) => collapseSpaces(item))
    .filter(Boolean);
};

const textUtils = {
  normNL,
  stripTicks,
  collapseSpaces,
  stripQuotes,
  stripBrackets,
  sanitizeText,
  parseListInput,
} as const;

export default textUtils;
