# Full Application Test Suite

**Suite ID:** SUITE-1775765749606  
**Component:** all  
**Generated:** 2026-04-09T20:15:49.606Z  
**Requirements:** demo-app/REQUIREMENTS.md  

## Coverage Summary

| Type | Count |
|------|-------|
| Functional | 3 |
| Negative | 2 |
| Edge Cases | 1 |
| UI | 0 |
| API | 1 |
| Mobile | 1 |
| **Total** | **8** |

---

## Test Cases

### TC-001: Successful login with valid credentials returns JWT and redirects to dashboard

**Component:** Login  
**Type:** functional  
**Priority:** P0  
**Status:** draft  
**Tags:** login, authentication, jwt, happy-path  

**Description:** Verify that a registered user can log in with correct email and password, receives a valid JWT token, and is redirected to the task dashboard.

**Preconditions:**
- TaskMaster frontend is running on http://localhost:3000
- TaskMaster backend is running on http://localhost:3001
- A registered user account exists with email 'testuser@example.com' and password 'Password1'

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Open a browser and navigate to http://localhost:3000/login | The Login page is displayed with email and password input fields and a Submit button |
| 2 | Enter 'testuser@example.com' into the Email field | The email value appears correctly in the input field |
| 3 | Enter 'Password1' into the Password field | The password is masked and accepted |
| 4 | Click the Login / Submit button | A POST request is sent to http://localhost:3001/api/auth/login |
| 5 | Observe the HTTP response and the UI state after the request completes | The API returns HTTP 200 with a JSON body containing 'token' and 'user' object (id, name, email); the frontend stores the token and redirects the user to the task dashboard route |
| 6 | Inspect browser local storage or session storage for the JWT token | A JWT token is present and non-empty in storage |

**Expected Result:** User is authenticated, JWT is stored client-side, and the task dashboard is displayed without any error messages.

**Acceptance Criteria:**
- [ ] API responds with HTTP 200
- [ ] Response body contains 'token' (non-empty string) and 'user' with correct id, name, and email
- [ ] Frontend redirects to dashboard route after successful login
- [ ] No error message is shown on screen

---

### TC-002: Authenticated user can create a new task with all required and optional fields

**Component:** Task CRUD  
**Type:** functional  
**Priority:** P0  
**Status:** draft  
**Tags:** task, create, crud, happy-path  

**Description:** Verify that a logged-in user can create a task by providing title, description, priority, and due date, and the task appears in the task list.

**Preconditions:**
- TaskMaster frontend is running on http://localhost:3000
- TaskMaster backend is running on http://localhost:3001
- User is logged in and on the task dashboard
- A valid JWT token is stored in the browser

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Click the 'Add Task' or 'New Task' button on the dashboard | A task creation form or modal is displayed with fields: Title, Description, Priority (dropdown), Due Date |
| 2 | Enter 'Buy groceries' in the Title field | Title field accepts and displays the text |
| 3 | Enter 'Milk, eggs, bread' in the Description field | Description field accepts and displays the text |
| 4 | Select 'high' from the Priority dropdown | 'high' is selected as priority |
| 5 | Enter a future date (e.g., '2025-12-31') in the Due Date field | Due date field accepts the date value |
| 6 | Click the Save / Create Task button | A POST request is sent to http://localhost:3001/api/tasks with Authorization header and the task payload |
| 7 | Observe the API response and the updated task list on the dashboard | API returns HTTP 201 with the newly created task object including a generated 'id', 'completed: false', and correct field values; the task 'Buy groceries' appears in the task list |

**Expected Result:** New task is persisted in the database, returned with a unique ID, and displayed in the task list with correct title, priority, and due date.

**Acceptance Criteria:**
- [ ] API responds with HTTP 201
- [ ] Response body contains the new task with auto-generated id, correct title, description, priority, due_date, and completed = false
- [ ] Task appears in the dashboard task list immediately after creation
- [ ] No error messages are displayed

---

### TC-003: Authenticated user can update an existing task's title and priority

**Component:** Task CRUD  
**Type:** functional  
**Priority:** P0  
**Status:** draft  
**Tags:** task, update, crud, happy-path  

**Description:** Verify that a logged-in user can edit an existing task, change its title and priority, save the changes, and the updated values persist in the UI and database.

**Preconditions:**
- User is logged in and on the task dashboard
- At least one existing task is visible in the task list (e.g., task with title 'Buy groceries')

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Locate the task 'Buy groceries' in the task list and click its Edit button or title link | An edit form or modal is displayed pre-populated with the task's current values |
| 2 | Clear the Title field and enter 'Buy groceries and vegetables' | Title field displays the new text |
| 3 | Change the Priority dropdown from 'high' to 'medium' | 'medium' is selected |
| 4 | Click the Save / Update button | A PUT request is sent to http://localhost:3001/api/tasks/:id with Authorization header and updated fields |
| 5 | Observe the API response and the task list | API returns HTTP 200 with the updated task object; the task list shows the new title 'Buy groceries and vegetables' with priority 'medium' |
| 6 | Reload the page and locate the same task | Updated title and priority are still displayed, confirming database persistence |

**Expected Result:** Task is updated in the database with the new title and priority, and changes are reflected in the UI after reload.

**Acceptance Criteria:**
- [ ] API responds with HTTP 200
- [ ] Response body contains the task with updated title and priority values
- [ ] Updated values persist after a page reload
- [ ] The updated_at timestamp is newer than the original created_at timestamp

---

### TC-004: Login fails with incorrect password and shows error message

**Component:** Login  
**Type:** negative  
**Priority:** P0  
**Status:** draft  
**Tags:** login, authentication, negative, security  

**Description:** Verify that attempting to log in with a valid registered email but an incorrect password returns HTTP 401 and displays an appropriate error message to the user.

**Preconditions:**
- TaskMaster frontend is running on http://localhost:3000
- TaskMaster backend is running on http://localhost:3001
- A registered user account exists with email 'testuser@example.com'

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Navigate to http://localhost:3000/login | Login page is displayed |
| 2 | Enter 'testuser@example.com' in the Email field | Email value is accepted |
| 3 | Enter 'WrongPassword99' in the Password field | Password value is masked and accepted |
| 4 | Click the Login / Submit button | A POST request is sent to http://localhost:3001/api/auth/login |
| 5 | Observe the API response and the UI | API returns HTTP 401 with JSON body { error: 'Invalid email or password' }; the frontend displays an error message on screen (e.g., 'Invalid email or password') |
| 6 | Check that no JWT token has been stored in browser storage | No token exists in localStorage or sessionStorage; user remains on the login page |

**Expected Result:** Login is rejected, no token is issued, user stays on the login page, and a clear error message is displayed.

**Acceptance Criteria:**
- [ ] API responds with HTTP 401
- [ ] Response body contains { error: 'Invalid email or password' }
- [ ] No JWT token is stored in browser storage
- [ ] An error message is visible on the login page
- [ ] User is not redirected to the dashboard

---

### TC-005: Creating a task without a title is rejected and shows a validation error

**Component:** Task CRUD  
**Type:** negative  
**Priority:** P1  
**Status:** draft  
**Tags:** task, create, validation, negative  

**Description:** Verify that submitting a new task form with the Title field empty is rejected by both the frontend and the API, and the user sees an appropriate validation error.

**Preconditions:**
- User is logged in and on the task dashboard
- The task creation form is accessible

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Click the 'Add Task' or 'New Task' button on the dashboard | Task creation form is displayed |
| 2 | Leave the Title field completely empty | Title field remains blank |
| 3 | Enter 'low' as Priority and a valid due date | Other fields are filled |
| 4 | Click the Save / Create Task button | Either client-side validation prevents submission and shows an inline error, OR a POST request is sent to http://localhost:3001/api/tasks |
| 5 | If a request was sent, observe the API response | API returns HTTP 400 with a JSON error body indicating that title is required (e.g., { error: 'Title is required' }) |
| 6 | Check the task list on the dashboard | No new task has been added to the list |

**Expected Result:** Task creation is blocked, no task record is created in the database, and a validation error message is shown to the user.

**Acceptance Criteria:**
- [ ] Task is not created (HTTP 400 from API, or client-side validation prevents submission)
- [ ] A descriptive error message is displayed to the user
- [ ] Task list count does not increase
- [ ] Form remains open for the user to correct the input

---

### TC-006: Task title at maximum boundary length (255 characters) is accepted; 256 characters is rejected or truncated

**Component:** Task CRUD  
**Type:** edge-case  
**Priority:** P2  
**Status:** draft  
**Tags:** task, boundary, edge-case, validation, title  

**Description:** Verify boundary behavior for the task title field. A title of 255 characters should be accepted, while behavior for 256 characters should be defined and consistent (rejected with error or truncated).

**Preconditions:**
- User is logged in and on the task dashboard
- Task creation form is accessible

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Open the task creation form | Form is displayed with a Title field |
| 2 | Generate a string of exactly 255 characters (e.g., repeat 'A' 255 times) and paste it into the Title field | The Title field accepts the 255-character string |
| 3 | Select any valid Priority and click Save | POST request is sent to /api/tasks with the 255-character title |
| 4 | Observe the API response | API returns HTTP 201; task is created with the full 255-character title |
| 5 | Open the task creation form again and enter a title of exactly 256 characters | Input field either truncates to 255 characters or accepts 256 characters for submission |
| 6 | Click Save and observe the response | If the application enforces a 255-character limit: HTTP 400 is returned with a validation error, or client prevents submission. If no limit is enforced, document actual behavior. |
| 7 | Check that a 1-character title (single letter) is also accepted | API returns HTTP 201 for a single-character title; task appears in task list |

**Expected Result:** A 255-character title is accepted and stored. Behavior for a 256-character title is consistent with application constraints (rejected or truncated). A 1-character title is always accepted.

**Acceptance Criteria:**
- [ ] Task with 255-character title is created successfully (HTTP 201)
- [ ] Task with 1-character title is created successfully (HTTP 201)
- [ ] Behavior for titles exceeding any documented maximum is consistent and predictable
- [ ] If validation fails, HTTP 400 is returned with a descriptive error

---

### TC-007: Accessing task endpoints without a JWT token returns 401 Unauthorized

**Component:** API  
**Type:** api  
**Priority:** P0  
**Status:** draft  
**Tags:** api, authentication, security, jwt, 401  

**Description:** Verify that all protected task API endpoints return HTTP 401 when called without an Authorization header, ensuring unauthenticated access is blocked.

**Preconditions:**
- TaskMaster backend is running on http://localhost:3001
- An API client (e.g., Postman, curl, or a REST client) is available
- At least one task exists in the database for GET/PUT/DELETE tests

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Send a GET request to http://localhost:3001/api/tasks with NO Authorization header | Response is HTTP 401 with JSON body { error: 'Unauthorized' } or similar unauthorized message |
| 2 | Send a POST request to http://localhost:3001/api/tasks with a valid task body but NO Authorization header | Response is HTTP 401; no task is created in the database |
| 3 | Send a PUT request to http://localhost:3001/api/tasks/1 with valid update body but NO Authorization header | Response is HTTP 401; task data is not modified |
| 4 | Send a DELETE request to http://localhost:3001/api/tasks/1 with NO Authorization header | Response is HTTP 401; task is not deleted |
| 5 | Send a GET request to http://localhost:3001/api/tasks with an Authorization header containing an expired or malformed token (e.g., 'Bearer invalidtoken123') | Response is HTTP 401 with an error message indicating the token is invalid or expired |
| 6 | Verify the database state after all the above requests | No data was created, modified, or deleted as a result of unauthenticated requests |

**Expected Result:** All task API endpoints consistently return HTTP 401 when called without a valid JWT token, and no data mutations occur.

**Acceptance Criteria:**
- [ ] GET /api/tasks without token returns HTTP 401
- [ ] POST /api/tasks without token returns HTTP 401 and creates no task
- [ ] PUT /api/tasks/:id without token returns HTTP 401 and modifies no task
- [ ] DELETE /api/tasks/:id without token returns HTTP 401 and deletes no task
- [ ] An invalid or malformed token also results in HTTP 401
- [ ] Response body contains an error field with a meaningful message

---

### TC-008: Task dashboard renders correctly and is fully usable at 480px mobile viewport width

**Component:** Mobile layout  
**Type:** mobile  
**Priority:** P1  
**Status:** draft  
**Tags:** mobile, responsive, layout, 480px, ux  

**Description:** Verify that the TaskMaster task dashboard layout adapts correctly to a 480px-wide mobile viewport, ensuring all key UI elements are visible, readable, and interactive without horizontal scrolling.

**Preconditions:**
- TaskMaster frontend is running on http://localhost:3000
- User is logged in and has at least 3 tasks in the list
- Browser DevTools or a physical/emulated mobile device is available
- Viewport is set to 480px width (e.g., via Chrome DevTools device emulation)

**Test Steps:**

| Step | Action | Expected Outcome |
|------|--------|-----------------|
| 1 | Open Chrome DevTools (F12), go to Device Toolbar, and set the viewport to 480px wide x 850px tall | Viewport is set to 480px; the page reloads or re-renders at the new size |
| 2 | Navigate to http://localhost:3000 and log in if not already authenticated | Login form is displayed in a single-column layout; fields and button are full-width and easily tappable |
| 3 | After login, observe the task dashboard layout | Navigation header or menu is visible; if a hamburger/collapsed menu is used, the icon is visible and functional; task list is displayed in a vertical single-column format |
| 4 | Scroll through the task list and check for horizontal overflow | No horizontal scrollbar is present; all task cards/rows fit within the 480px width without content being clipped |
| 5 | Tap or click the 'Add Task' button | Task creation form opens and is fully visible and usable within the 480px viewport; all form fields are accessible without horizontal scrolling |
| 6 | Create a new task by filling in Title and selecting Priority, then tapping Save | Task is created successfully and appears in the task list; success feedback is visible on screen |
| 7 | Tap the Edit button on an existing task card | Edit form is displayed correctly within the mobile viewport; Save and Cancel buttons are accessible |
| 8 | Tap the Delete button on a task and confirm deletion | Task is removed from the list; confirmation dialog (if present) is fully visible and interactive at 480px |
| 9 | Check font sizes, button sizes, and touch target sizes across all visible elements | Text is legible without zooming; interactive elements (buttons, inputs) have a minimum touch target size of approximately 44x44px; no text overlaps |

**Expected Result:** The full task management workflow (view, create, edit, delete) is functional and visually correct at 480px viewport width with no horizontal scrolling and adequate touch target sizes.

**Acceptance Criteria:**
- [ ] Dashboard layout is single-column at 480px width
- [ ] No horizontal scrollbar or content overflow is present
- [ ] All CRUD actions (add, edit, delete, complete) are accessible and functional
- [ ] Form fields and buttons are full-width and tappable
- [ ] Text is legible without user-initiated zoom
- [ ] Navigation elements are accessible at mobile width

---
