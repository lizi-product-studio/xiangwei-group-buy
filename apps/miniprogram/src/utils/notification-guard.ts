export type NotificationEnableDecision = "LOGIN_REQUIRED" | "BUSY" | "PROCEED";

/** Pure ordering contract for the reminder action. */
export function notificationEnableDecision(
  loggedIn: boolean,
  busy: boolean,
): NotificationEnableDecision {
  if (!loggedIn) return "LOGIN_REQUIRED";
  if (busy) return "BUSY";
  return "PROCEED";
}
