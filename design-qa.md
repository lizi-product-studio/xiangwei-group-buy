# Admin Login Design QA

final result: passed

Evidence refreshed from the final reviewed code on 2026-09-03 after the
rate-limit, disabled-control, password-setup and session-boundary fixes. No
credential shown in these captures belongs to a real environment.

## Scope

- Source visual: `.visual-audit-2026-09-02/admin-login/screens/01-login-ideation.png`
- Implementation capture: `.visual-audit-2026-09-02/admin-login/implementation/02-login-1440x1024.png`
- Compared state and viewport: unauthenticated default login, `1440 × 1024`

## Comparison result

- The desktop split is aligned with the approved composition: narrative panel `54%`, form panel `46%`.
- The implemented form begins at approximately `x=876, y=205`, has a `466px` content width, and matches the source hierarchy for title, fields, primary action, and recovery link.
- The approved sorghum-field asset, navy overlay, warm-white work surface, orange rule, and accessible dark-orange CTA are present without placeholder art.
- Passwords remain masked by default; the real icon control toggles visibility and has a usable focus target.

## State and responsive evidence

- `03-login-1440x900.png`: compressed-height desktop layout.
- `04-login-900.png`, `05-login-768.png`, `06-login-375.png`: responsive layouts with no page-level horizontal overflow.
- `07-field-errors.png`: field-level required validation.
- `08-rate-limit.png`: Retry-After countdown, recovery contact and disabled
  login controls while the window is active.
- `09-force-password-change.png`: restricted temporary-password change state.
- `10-session-expired.png`: recoverable session-expiry notice.
- `11-loading.png`: disabled/loading submit, fields, password-visibility and
  recovery controls.
- `12-invalid-credentials.png`: generic credential error with password cleared.
- `13-network-error.png`: recoverable service-connection error with retry and
  escalation guidance, without raw status or stack output.

All four responsive captures were generated with an explicit horizontal
overflow assertion. The session-expiry and password-setup captures use only
synthetic local browser fixtures.

## Remaining polish

- P3: the existing Ant Design branch mark is the closest available library icon to the reference plant glyph; it does not affect hierarchy, accessibility, or task completion.
