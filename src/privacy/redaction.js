import { PRIVACY_PROFILES, DEFAULT_PRIVACY_PROFILE } from './constants.js';
import { luhnValid } from '../utils/validation.js';

export const REDACTION_PATTERNS = {
  email: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
  krPhone: /\b01[016789]-?\d{3,4}-?\d{4}\b/g,
  intlPhone: /\+\d{1,3}\s?\d{1,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g,
  rrn: /\b\d{6}-?\d{7}\b/g,
  card: /\b(?:\d[ -]?){13,19}\b/g,
  ip: /\b\d{1,3}(\.\d{1,3}){3}\b/g,
  handle: /@[A-Za-z0-9_]{2,30}\b/g,
  addressHint: /(\d+호|\d+동|[가-힣]{2,}(로|길)\s?\d+(-\d+)?)/g,
};

export const escapeForRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createRedactionRules = (profileKey, profiles = PRIVACY_PROFILES) => {
  const profile = profiles[profileKey] || profiles[DEFAULT_PRIVACY_PROFILE];
  const rules = [
    {
      name: 'EMAIL',
      rx: REDACTION_PATTERNS.email,
      mask: () => '[REDACTED:EMAIL]',
    },
    {
      name: 'PHONE',
      rx: REDACTION_PATTERNS.krPhone,
      mask: () => '[REDACTED:PHONE]',
    },
    {
      name: 'PHONE',
      rx: REDACTION_PATTERNS.intlPhone,
      mask: () => '[REDACTED:PHONE]',
    },
    {
      name: 'RRN',
      rx: REDACTION_PATTERNS.rrn,
      mask: () => '[REDACTED:RRN]',
    },
    {
      name: 'CARD',
      rx: REDACTION_PATTERNS.card,
      validator: luhnValid,
      mask: () => '[REDACTED:CARD]',
    },
    {
      name: 'IP',
      rx: REDACTION_PATTERNS.ip,
      mask: () => '[REDACTED:IP]',
    },
    {
      name: 'HANDLE',
      rx: REDACTION_PATTERNS.handle,
      mask: () => '[REDACTED:HANDLE]',
    },
  ];

  if (profile?.maskAddressHints) {
    rules.push({
      name: 'ADDR',
      rx: REDACTION_PATTERNS.addressHint,
      mask: () => '[REDACTED:ADDR]',
    });
  }

  return rules;
};

const protectWhitelist = (text, whitelist) => {
  if (!Array.isArray(whitelist) || !whitelist.length) return { text, tokens: [] };
  let output = text;
  const tokens = [];
  whitelist.forEach((term, index) => {
    if (!term) return;
    const token = `§WL${index}_${term.length}§`;
    const rx = new RegExp(escapeForRegex(term), 'gi');
    let replaced = false;
    output = output.replace(rx, () => {
      replaced = true;
      return token;
    });
    if (replaced) tokens.push({ token, value: term });
  });
  return { text: output, tokens };
};

const restoreWhitelist = (text, tokens) => {
  if (!tokens?.length) return text;
  return tokens.reduce((acc, { token, value }) => acc.replace(new RegExp(escapeForRegex(token), 'g'), value), text);
};

const applyRules = (text, rules, counts) => {
  return rules.reduce((acc, rule) => {
    if (!rule?.rx) return acc;
    return acc.replace(rule.rx, (match) => {
      if (rule.validator && !rule.validator(match)) return match;
      counts[rule.name] = (counts[rule.name] || 0) + 1;
      return typeof rule.mask === 'function' ? rule.mask(match) : rule.mask;
    });
  }, text);
};

const applyCustomBlacklist = (text, blacklist, counts) => {
  if (!Array.isArray(blacklist) || !blacklist.length) return text;
  let output = text;
  blacklist.forEach((term) => {
    if (!term) return;
    const rx = new RegExp(escapeForRegex(term), 'gi');
    output = output.replace(rx, () => {
      counts.CUSTOM = (counts.CUSTOM || 0) + 1;
      return '[REDACTED:CUSTOM]';
    });
  });
  return output;
};

const MINOR_KEYWORDS =
  /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18|중딩|고딩|중[1-3]|고[1-3]|(?:13|14|15|16|17)\s*살|teen(?:ager)?|underage)/i;
const SEXUAL_KEYWORDS = /(성관계|성적|섹스|sex|음란|선정|야한|야스|삽입|자위|강간|에로)/i;
const MINOR_KEYWORDS_MATCH =
  /(미성년|중학생|고등학생|나이\s*1[0-7]|소년|소녀|minor|under\s*18|중딩|고딩|중[1-3]|고[1-3]|(?:13|14|15|16|17)\s*살|teen(?:ager)?|underage)/gi;
const SEXUAL_KEYWORDS_MATCH = /(성관계|성적|섹스|sex|음란|선정|야한|야스|삽입|자위|강간|에로)/gi;
const ACADEMIC_PATTERN = /성적\s*(향상|저하|관리|평가|우수|부진|분석|상승|하락)/i;
const SEX_ED_PATTERN = /성\s*(교육|상담|발달|정체성|소수자|평등|인지|지식)/i;
const ORIENTATION_PATTERN = /성적\s*(지향|취향|매력|선호)/i;
const PROTECTIVE_FORWARD = /(교육|예방|캠페인|세미나|강연|워크샵|보호|지원|상담|치료|개입|법률)\s*.*\s*(미성년|청소년)/i;
const PROTECTIVE_REVERSE = /(미성년|청소년)\s*.*\s*(교육|예방|캠페인|세미나|강연|워크샵|보호|지원|상담|치료|개입|법률)/i;
const RIGHTS_PATTERN = /성적\s*(자기결정권|권리|자율성|주체성|건강|동의)/i;
const EXPLICIT_MEDIA = /(야한|음란|에로)\s*(사진|영상|동영상|이미지|pic|video|gif)/i;
const EXPLICIT_CRIME = /(강간|성폭행|몰카|아청법)/i;
const PROXIMITY_WINDOW = 100;

const calculateProximityScore = (text) => {
  if (!text) return 0;
  const minorMatches = [...String(text).matchAll(MINOR_KEYWORDS_MATCH)];
  const sexualMatches = [...String(text).matchAll(SEXUAL_KEYWORDS_MATCH)];
  if (!minorMatches.length || !sexualMatches.length) return 0;

  let maxScore = 0;
  minorMatches.forEach((minor) => {
    sexualMatches.forEach((sexual) => {
      const distance = Math.abs(minor.index - sexual.index);
      if (distance > PROXIMITY_WINDOW) return;
      const score = 100 - distance;
      if (score > maxScore) {
        maxScore = score;
      }
    });
  });
  return maxScore;
};

export const hasMinorSexualContext = (text) => {
  if (!text) return false;

  const safeText = String(text);
  if (!MINOR_KEYWORDS.test(safeText)) return false;
  if (!SEXUAL_KEYWORDS.test(safeText)) return false;

  const hasLegitimateContext =
    ACADEMIC_PATTERN.test(safeText) ||
    SEX_ED_PATTERN.test(safeText) ||
    ORIENTATION_PATTERN.test(safeText) ||
    PROTECTIVE_FORWARD.test(safeText) ||
    PROTECTIVE_REVERSE.test(safeText) ||
    RIGHTS_PATTERN.test(safeText);

  const hasExplicitDanger = EXPLICIT_CRIME.test(safeText) || EXPLICIT_MEDIA.test(safeText);

  if (hasLegitimateContext && !hasExplicitDanger) {
    return false;
  }

  const proximityScore = calculateProximityScore(safeText);
  return proximityScore >= 70;
};

export const redactText = (
  text,
  profileKey,
  counts,
  config,
  profiles = PRIVACY_PROFILES,
) => {
  const whitelist = config?.whitelist || [];
  const blacklist = config?.blacklist || [];
  const profile = profiles[profileKey] || profiles[DEFAULT_PRIVACY_PROFILE];
  const rules = createRedactionRules(profile.key, profiles);
  const safeText = String(text ?? '');
  const { text: protectedText, tokens } = protectWhitelist(safeText, whitelist);
  let result = applyRules(protectedText, rules, counts);
  result = applyCustomBlacklist(result, blacklist, counts);
  result = restoreWhitelist(result, tokens);

  if (profile.maskNarrativeSensitive) {
    result = result.replace(/(자살|자해|강간|폭행|살해)/gi, () => {
      counts.SENSITIVE = (counts.SENSITIVE || 0) + 1;
      return '[REDACTED:SENSITIVE]';
    });
  }

  return result;
};

export const formatRedactionCounts = (counts) => {
  const entries = Object.entries(counts || {}).filter(([, value]) => value > 0);
  if (!entries.length) return '레다크션 없음';
  return entries.map(([key, value]) => `${key}:${value}`).join(', ');
};
