import { AuthRequiredError, clearAccessToken, getAccessToken } from "./auth.js";
import { HttpError } from "./util.js";

/** fetch con il token dell'utente loggato; errori tradotti in HttpError / AuthRequiredError. */
export async function authFetch(url, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearAccessToken();
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    let message = `Errore ${res.status}`;
    try {
      const body = await res.json();
      message = body.error?.message || body.error_description || message;
    } catch {
      // risposta senza JSON
    }
    throw new HttpError(res.status, message);
  }
  return res;
}

export const authJson = async (url, init) => (await authFetch(url, init)).json();

export const jsonBody = (method, body, headers = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
