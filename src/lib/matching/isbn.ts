export function normalizeIsbn(isbn: string): string {
  return isbn.replace(/[-\s]/g, '');
}

export function validateIsbn10(isbn: string): boolean {
  const digits = normalizeIsbn(isbn);
  if (!/^\d{9}[\dX]$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (10 - i) * parseInt(digits[i], 10);
  }
  const last = digits[9];
  const check = last === 'X' ? 10 : parseInt(last, 10);
  return (sum + check) % 11 === 0;
}

export function validateIsbn13(isbn: string): boolean {
  const digits = normalizeIsbn(isbn);
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(digits[12], 10);
}

export function isbn10to13(isbn10: string): string | null {
  const digits = normalizeIsbn(isbn10);
  if (!validateIsbn10(digits)) return null;
  const base = '978' + digits.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

export function isbn13to10(isbn13: string): string | null {
  const digits = normalizeIsbn(isbn13);
  if (!validateIsbn13(digits)) return null;
  if (!digits.startsWith('978')) return null; // 979 prefix not convertible to ISBN-10
  const base = digits.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(base[i], 10) * (10 - i);
  }
  const check = (11 - (sum % 11)) % 11;
  return base + (check === 10 ? 'X' : String(check));
}
