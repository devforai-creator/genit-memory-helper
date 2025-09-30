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

export default {
  looksLikeName,
  luhnValid,
};
