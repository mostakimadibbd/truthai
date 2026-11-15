/**
 * Deterministic conversation ordering for chat messages.
 *
 * A user message and its assistant reply are written in the same
 * server batch, so their createdAt timestamps routinely share the
 * same millisecond. Firestore's orderBy("createdAt") breaks such
 * ties by document id — effectively random — which put replies
 * above the messages they answer, both on screen and in the
 * history sent to the model.
 *
 * The rule applied everywhere messages are read back: order by
 * createdAt; within the same millisecond, a user message always
 * precedes an assistant message. The sort is stable, so all other
 * relative order is preserved. New writes additionally stamp the
 * reply 1 ms after its message (see app/api/chat/route.ts), so
 * ties stop occurring at the source; this ordering repairs the
 * pairs already stored with equal timestamps.
 */
export function sortByConversationOrder<T>(
  items: readonly T[],
  createdAtMillis: (item: T) => number,
  role: (item: T) => string,
): T[] {
  const rank = (value: string) => (value === "user" ? 0 : 1);
  return [...items].sort((a, b) => {
    const byTime = createdAtMillis(a) - createdAtMillis(b);
    if (byTime !== 0) return byTime;
    return rank(role(a)) - rank(role(b));
  });
}
