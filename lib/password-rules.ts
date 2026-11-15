// Password composition rules for account creation and password
// changes — one source of truth shared by the sign-up form (live
// checklist + strength meter) and the server routes (enforcement).
// Owner's requirements (2026-11-16): length, a lowercase letter, an
// uppercase letter, and a symbol are all mandatory, and the form
// shows live, in red, exactly which rule is still missing.

export type PasswordRule = {
  id: "length" | "lowercase" | "uppercase" | "symbol";
  label: string;
  requirement: string;
  met: boolean;
};

export function passwordRuleResults(password: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: "At least 10 characters",
      requirement: "at least 10 characters",
      met: password.length >= 10,
    },
    {
      id: "lowercase",
      label: "A lowercase letter (a–z)",
      requirement: "a lowercase letter",
      met: /[a-z]/.test(password),
    },
    {
      id: "uppercase",
      label: "An uppercase letter (A–Z)",
      requirement: "an uppercase letter",
      met: /[A-Z]/.test(password),
    },
    {
      id: "symbol",
      label: "A symbol (e.g. ! @ # $ %)",
      requirement: "a symbol such as ! @ # $ %",
      met: /[^A-Za-z0-9\s]/.test(password),
    },
  ];
}

export function passwordMeetsRules(password: string): boolean {
  return passwordRuleResults(password).every((rule) => rule.met);
}

/** "Your password still needs: an uppercase letter and a symbol…" */
export function passwordUnmetMessage(password: string): string | null {
  const unmet = passwordRuleResults(password).filter((rule) => !rule.met);
  if (!unmet.length) return null;
  const parts = unmet.map((rule) => rule.requirement);
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Your password still needs ${list}.`;
}

export type PasswordStrength = {
  /** 0–4, drives the meter segments. */
  score: number;
  label: "Weak" | "Fair" | "Good" | "Strong";
};

export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "Weak" };
  const met = passwordRuleResults(password).filter((rule) => rule.met).length;
  // All four rules met is "Good"; extra length earns "Strong".
  if (met === 4) {
    return password.length >= 14
      ? { score: 4, label: "Strong" }
      : { score: 3, label: "Good" };
  }
  if (met === 3) return { score: 2, label: "Fair" };
  return { score: 1, label: "Weak" };
}
