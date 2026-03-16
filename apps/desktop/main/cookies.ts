type ParsedCookie = {
  value: string;
  path?: string;
  secure?: boolean;
  httponly?: boolean;
  samesite?: string;
};

export function parseSetCookieHeader(
  headerValue: string,
): Map<string, ParsedCookie> {
  const cookies = new Map<string, ParsedCookie>();
  const parts = headerValue.split(/,(?=[^;]+=[^;]+)/g);

  for (const rawPart of parts) {
    const segments = rawPart
      .split(";")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const [nameValue, ...attributes] = segments;

    if (!nameValue) {
      continue;
    }

    const separatorIndex = nameValue.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const name = nameValue.slice(0, separatorIndex);
    const value = nameValue.slice(separatorIndex + 1);
    const cookie: ParsedCookie = { value };

    for (const attribute of attributes) {
      const [rawKey, rawValue] = attribute.split("=");
      const key = rawKey.toLowerCase();
      const normalizedValue = rawValue?.toLowerCase();

      if (key === "path" && rawValue) {
        cookie.path = rawValue;
      } else if (key === "secure") {
        cookie.secure = true;
      } else if (key === "httponly") {
        cookie.httponly = true;
      } else if (key === "samesite" && normalizedValue) {
        cookie.samesite = normalizedValue;
      }
    }

    cookies.set(name, cookie);
  }

  return cookies;
}
