import { getAuth } from 'firebase/auth';

const BASE_URL = 'https://asia-northeast1-polaris-app-yukid.cloudfunctions.net';

async function getIdToken(): Promise<string> {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

export async function callFunction<T>(
  name: string,
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST',
  timeoutMs?: number,
): Promise<T> {
  const token = await getIdToken();

  const controller = timeoutMs ? new AbortController() : undefined;
  const timerId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;

  try {
    const res = await fetch(`${BASE_URL}/${name}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[${name}] ${res.status}: ${err}`);
    }

    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`[${name}] invalid JSON response: ${text.slice(0, 200)}`);
    }
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}
