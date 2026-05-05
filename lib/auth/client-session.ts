let accessToken: string | null = null;
const accessTokenListeners = new Set<() => void>();

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  accessTokenListeners.forEach((listener) => listener());
}

export function clearAccessToken() {
  setAccessToken(null);
}

export function subscribeToAccessToken(listener: () => void) {
  accessTokenListeners.add(listener);

  return () => {
    accessTokenListeners.delete(listener);
  };
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const firstResponse = await fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (firstResponse.status !== 401) {
    return firstResponse;
  }

  const refreshResponse = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });

  if (!refreshResponse.ok) {
    clearAccessToken();
    if (typeof window !== 'undefined') {
      const nextPath = `${window.location.pathname}${window.location.search}`;
      const loginPath = window.location.pathname.startsWith('/mobile')
        ? '/mobile/login'
        : '/login';
      window.location.href = `${loginPath}?next=${encodeURIComponent(nextPath)}`;
    }
    return firstResponse;
  }

  const refreshPayload = (await refreshResponse.json()) as { accessToken: string };
  setAccessToken(refreshPayload.accessToken);

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set('Authorization', `Bearer ${refreshPayload.accessToken}`);

  return fetch(input, {
    ...init,
    headers: retryHeaders,
    credentials: 'include',
  });
}
