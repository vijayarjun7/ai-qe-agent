# QA Peer Review — Full Application Test Suite

**Review ID:** REV-1775765828675  
**Reviewed At:** 2026-04-09T20:17:08.675Z  
**Reviewer:** QA-Reviewer-AI  
**Verdict:** ❌ NEEDS-REVISION  
**Coverage Score:** 32/100  
**Quality Score:** 61/100  

## Review Comments

### Critical (1)

**[TC-006] overall:** TC-006 combines two distinct test scenarios (255 chars accepted AND 256 chars rejected/truncated) into a single test case. If one assertion fails, the other result is unrecorded. 'Rejected or truncated' is also an ambiguous expected result — truncation and rejection are opposite behaviors.
> 💡 Suggestion: Split into TC-006a (255 chars accepted, HTTP 200/201) and TC-006b (256 chars rejected, HTTP 422, no truncation silently allowed). Define which behavior is expected based on the specification and remove the 'or truncated' ambiguity.

### Major (8)

**[TC-001] expectedResult:** The title implies JWT verification and dashboard redirect, but without access to the steps it is unclear if the test validates the JWT payload (e.g., expiry, claims, algorithm) or merely that a token string is returned. Redirect assertion must specify the exact URL or route.
> 💡 Suggestion: Add explicit expected result: 'Response contains Authorization header with Bearer token; decoded JWT contains sub, exp, iat claims; browser URL changes to /dashboard within 2 seconds.'

**[TC-002] coverage:** Test covers create with all required AND optional fields in a single test. This conflates two distinct scenarios. If optional fields cause a failure it is unclear whether the failure relates to required or optional field handling.
> 💡 Suggestion: Split into TC-002a (required fields only) and TC-002b (all optional fields). Each should have its own pass/fail criteria.

**[TC-003] coverage:** TC-003 only covers updating title and priority. No test exists for updating other fields (due date, description, status, assignee). Also missing is a test for partial update (PATCH) vs full update (PUT) if both are supported by the API.
> 💡 Suggestion: Add separate test cases for each updatable field category, and add a negative case for updating a task owned by a different user (authorization boundary).

**[TC-004] coverage:** Only incorrect password is covered. Missing negative login scenarios: non-existent username, correct credentials for a deactivated account, SQL injection in username/password fields, and account lockout after N failed attempts.
> 💡 Suggestion: Add TC-004b through TC-004e covering: unknown username, locked account, deactivated account, and brute-force lockout threshold.

**[TC-006] coverage:** Boundary testing only covers the title field. If other text fields (description, comments) have length constraints, those are untested. Also missing: 0-character title (empty string) and 1-character title as lower boundary cases.
> 💡 Suggestion: Add lower boundary tests (0 chars, 1 char) and apply the same boundary analysis to other constrained fields.

**[TC-007] coverage:** TC-007 only tests missing JWT. Missing API security cases: expired JWT, malformed JWT, JWT with invalid signature, JWT with insufficient scope/role (authorization vs authentication), and reuse of a revoked/logged-out token.
> 💡 Suggestion: Add TC-007b (expired token returns 401), TC-007c (tampered signature returns 401), TC-007d (valid token but insufficient role returns 403).

**[TC-008] coverage:** Only 480px viewport is tested. Standard mobile breakpoints include 320px (small phones), 375px (iPhone SE), and 414px. Landscape orientation at mobile widths is also untested. A single viewport does not constitute mobile coverage.
> 💡 Suggestion: Add test cases for 320px (lower boundary), 375px (common iPhone), and 480px landscape orientation. Parameterize if the test framework supports it.

**[TC-008] expectedResult:** 'Renders correctly and is fully usable' is subjective and not a verifiable pass/fail criterion. No specific UI elements, interactions, or layout assertions are defined.
> 💡 Suggestion: Define specific assertions: 'Navigation menu collapses to hamburger icon; task cards stack vertically; touch targets are minimum 44x44px; no horizontal scrollbar appears; all task actions (create, edit, delete) are accessible without zooming.'

### Minor (8)

**[TC-001] preconditions:** No mention of precondition that the test user account must exist in a known state (active, not locked). If account state is not controlled, test is fragile.
> 💡 Suggestion: Add precondition: 'A verified, active user account with known credentials exists in the test environment database.'

**[TC-002] expectedResult:** The expected result should specify the exact confirmation mechanism: toast notification, inline success message, or redirect to task detail. 'Task is created' is not a verifiable criterion.
> 💡 Suggestion: Define: 'Task appears in task list with correct title, priority, and due date. API returns HTTP 201 with task ID in response body.'

**[TC-003] expectedResult:** No assertion on whether the previous values are overwritten vs merged, or whether a last-modified timestamp is updated.
> 💡 Suggestion: Add expected result: 'Updated fields reflect new values; unchanged fields retain original values; updatedAt timestamp is refreshed.'

**[TC-004] expectedResult:** The expected error message must be explicitly stated and validated against a security requirement: the message should not reveal whether the username or password was incorrect (credential enumeration risk).
> 💡 Suggestion: Add expected result: 'Generic error message displayed (e.g., Invalid credentials) without specifying which field was wrong. HTTP 401 returned. No JWT issued.'

**[TC-005] coverage:** Only missing title is covered. Other required fields (if any) are not individually tested. Also missing: whitespace-only title (e.g., spaces or tabs that pass client-side non-empty check but are semantically blank).
> 💡 Suggestion: Add TC-005b: 'Creating a task with a whitespace-only title is rejected at the server.' Enumerate all required fields and ensure each has a missing-field negative test.

**[TC-005] expectedResult:** Validation error test must specify both the UI error message text/location AND the HTTP status code returned by the API to constitute a full pass/fail criterion.
> 💡 Suggestion: Expected result: 'Inline error message appears below the title field; form is not submitted; API returns HTTP 422 with field-level error detail in response body.'

**[TC-007] expectedResult:** Expected result should also specify the response body format (e.g., RFC 7807 Problem Details or custom error schema) and that no task data is leaked in the error response.
> 💡 Suggestion: Add: 'Response body contains error code and message conforming to API error schema. No task data is present in the response.'

**[TC-008] preconditions:** No specification of which browser or device emulation tool to use. Results will differ between Chrome DevTools emulation, BrowserStack real device, and Safari iOS WebKit.
> 💡 Suggestion: Add precondition: 'Test executed on [specified browser] using [device emulator or real device]. Document tool and OS version for reproducibility.'

## Coverage Gaps

- ⚠️ No UI test cases exist (coverageScore shows 0 UI tests) — no tests for layout, accessibility (WCAG), or visual regression outside of TC-008
- ⚠️ No test for session expiry and automatic logout after inactivity timeout
- ⚠️ No test for JWT token refresh flow (silent refresh or re-authentication prompt)
- ⚠️ No test for concurrent login (same user logged in on multiple devices/browsers simultaneously)
- ⚠️ No test for account lockout after repeated failed login attempts (brute-force protection)
- ⚠️ No test for password reset or forgot password flow
- ⚠️ No test for task deletion (CRUD is incomplete — Delete operation entirely absent)
- ⚠️ No test for reading/listing tasks (CRUD is incomplete — Read/List operation absent)
- ⚠️ No test for task filtering, sorting, or search functionality
- ⚠️ No test for task assignment to another user or permission boundaries between users
- ⚠️ No test for unauthorized task modification (user A cannot edit user B's task)
- ⚠️ No test for pagination or infinite scroll on task list with large datasets
- ⚠️ No test for API rate limiting behavior
- ⚠️ No test for XSS injection in task title or description fields
- ⚠️ No test for CSRF protection on state-changing endpoints
- ⚠️ No test for server error handling (API returns 500 — how does the UI respond)
- ⚠️ No test for network failure or offline behavior
- ⚠️ No test for concurrent task editing by two users (race condition / optimistic locking)
- ⚠️ No accessibility tests (keyboard navigation, screen reader compatibility, ARIA labels)
- ⚠️ No test for logout functionality and token invalidation on server side
- ⚠️ No test for deep linking or direct URL navigation to task detail when not authenticated
- ⚠️ No performance or load test reference even at smoke level
- ⚠️ Mobile testing limited to one viewport; no tablet breakpoint coverage (768px, 1024px)

## Suggested Additions

- **Delete an existing task successfully removes it from the list and returns HTTP 204** (functional, P0)
  _Rationale: Delete operation is entirely absent from CRUD coverage. This is a P0 gap for a task management application._
- **Authenticated user can list and filter tasks by status, priority, and due date** (functional, P0)
  _Rationale: Read/List operation is absent from CRUD coverage. Filtering is core functionality with no test coverage._
- **User A cannot view, edit, or delete tasks belonging to User B — returns 403 Forbidden** (negative, P0)
  _Rationale: Authorization boundary between users is completely untested. This is a critical security gap._
- **Account is locked after 5 consecutive failed login attempts and returns appropriate error** (negative, P1)
  _Rationale: Brute-force protection is a security requirement not covered by TC-004._
- **Expired JWT token on task endpoint returns 401 and does not return task data** (api, P0)
  _Rationale: TC-007 only covers missing token. Expired and tampered tokens must be tested separately per security best practices._
- **JWT with valid signature but insufficient role returns 403 Forbidden on admin endpoints** (api, P1)
  _Rationale: Authentication vs authorization distinction is untested. A 401 vs 403 distinction is critical for correct security posture._
- **Session expires after inactivity period and user is redirected to login with informative message** (edge-case, P1)
  _Rationale: Session lifecycle management is entirely absent from the test suite._
- **Logout invalidates JWT on server side and subsequent requests with old token return 401** (functional, P0)
  _Rationale: Logout functionality and server-side token revocation are not tested anywhere in the suite._
- **Task title with whitespace-only content is rejected with validation error** (negative, P1)
  _Rationale: Whitespace-only titles may bypass client-side required field validation but should be rejected server-side. Not covered by TC-005._
- **XSS payload in task title is escaped and rendered as plain text, not executed** (negative, P0)
  _Rationale: No security injection tests exist. XSS via stored task content is a critical vulnerability class._
- **Task dashboard is keyboard navigable and meets WCAG 2.1 AA contrast and focus requirements** (ui, P1)
  _Rationale: Zero accessibility tests exist in the suite. Accessibility is a legal and quality requirement._
- **Task list loads and displays correctly when API returns 500 Internal Server Error** (negative, P1)
  _Rationale: No error handling tests exist for server failures. User-facing error states must be verified._
- **Task title boundary test: 1-character title is accepted; empty string is rejected** (edge-case, P2)
  _Rationale: Lower boundary (0 and 1 character) is not tested. TC-006 only covers upper boundary._
- **Task dashboard renders correctly at 320px viewport (small mobile) and 768px (tablet)** (mobile, P1)
  _Rationale: TC-008 covers only 480px. 320px and 768px are critical breakpoints that need independent verification._
- **Unauthenticated user navigating directly to /dashboard is redirected to /login** (functional, P0)
  _Rationale: Route protection for authenticated routes is not tested. Direct URL access is a common attack vector._

## Approved Tests
_None_

## Flagged for Revision
TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007, TC-008