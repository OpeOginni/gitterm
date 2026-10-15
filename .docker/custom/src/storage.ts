export function readSetting(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(`gitterm:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(`gitterm:${key}`, value);
  } catch {
    /* Storage may be blocked in embeds. */
  }
}
