// Helper for front components to call this app's HTTP-route logic functions.
// Front components run sandboxed in the browser; logic functions run server-side.
// They communicate over the `/s/` endpoint, authenticated with the app token
// that Twenty injects into the worker.

export async function callAppRoute<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const apiUrl = process.env.TWENTY_API_URL ?? "";
  const token = process.env.TWENTY_APP_ACCESS_TOKEN;

  const res = await fetch(`${apiUrl}/s${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Logic function failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
