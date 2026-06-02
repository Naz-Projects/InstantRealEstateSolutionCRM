// Convex functions throw ConvexError; the user-facing string is at err.data.message.
export function errMsg(e: unknown, fallback: string): string {
  const data = (e as { data?: { message?: string } })?.data;
  if (data?.message) return data.message;
  return e instanceof Error ? e.message : fallback;
}
