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
  method: 'GET' | 'POST' = 'POST'
): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(`${BASE_URL}/${name}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[${name}] ${res.status}: ${err}`);
  }

  return res.json() as Promise<T>;
}
