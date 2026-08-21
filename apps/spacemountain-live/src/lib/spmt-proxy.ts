type RequestHeaders = Record<string, string | string[] | undefined>;

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function buildSpmtProxyHeaders(
  requestHeaders: RequestHeaders,
  token: string | undefined,
  hasBody: boolean,
) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (hasBody) headers['Content-Type'] = 'application/json';

  const ifMatch = firstHeaderValue(requestHeaders['if-match']);
  if (ifMatch) headers['If-Match'] = ifMatch;

  const ifNoneMatch = firstHeaderValue(requestHeaders['if-none-match']);
  if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;

  return headers;
}
