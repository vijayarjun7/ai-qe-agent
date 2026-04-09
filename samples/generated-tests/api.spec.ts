import { test, expect, APIRequestContext } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3001' });

let request: APIRequestContext;
let authToken: string;
let userId: string;
let createdTaskId: string;

const testUser = {
  email: `testuser_${Date.now()}@example.com`,
  password: 'SecurePassword123!',
  name: 'Test User',
};

test.describe('Task Manager API Test Suite', () => {
  test.describe('Auth - Register', () => {
    test('POST /api/auth/register - success 201', async ({ request }) => {
      const newUser = {
        email: `register_${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        name: 'Register Test User',
      };

      const response = await request.post('/api/auth/register', {
        data: newUser,
      });

      expect(response.status()).toBe(201);

      const body = await response.json();
      expect(body).toHaveProperty('user');
      expect(body).toHaveProperty('token');
      expect(body.user).toHaveProperty('id');
      expect(body.user).toHaveProperty('email', newUser.email);
      expect(body.user).toHaveProperty('name', newUser.name);
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
    });

    test('POST /api/auth/register - duplicate email returns 4xx', async ({ request }) => {
      const duplicateUser = {
        email: `duplicate_${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        name: 'Duplicate User',
      };

      await request.post('/api/auth/register', { data: duplicateUser });

      const response = await request.post('/api/auth/register', {
        data: duplicateUser,
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });

    test('POST /api/auth/register - missing required fields returns 4xx', async ({ request }) => {
      const response = await request.post('/api/auth/register', {
        data: { email: 'incomplete@example.com' },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });

    test('POST /api/auth/register - invalid email format returns 4xx', async ({ request }) => {
      const response = await request.post('/api/auth/register', {
        data: { email: 'not-an-email', password: 'SecurePassword123!', name: 'Bad Email User' },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });
  });

  test.describe('Auth - Login', () => {
    test.beforeAll(async ({ playwright }) => {
      request = await playwright.request.newContext({ baseURL: 'http://localhost:3001' });

      const registerResponse = await request.post('/api/auth/register', {
        data: testUser,
      });
      expect(registerResponse.status()).toBe(201);
    });

    test.afterAll(async () => {
      await request.dispose();
    });

    test('POST /api/auth/login - success 200', async ({ request }) => {
      const response = await request.post('/api/auth/login', {
        data: { email: testUser.email, password: testUser.password },
      });

      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('user');
      expect(body).toHaveProperty('token');
      expect(body.user).toHaveProperty('id');
      expect(body.user).toHaveProperty('email', testUser.email);
      expect(body.user).toHaveProperty('name', testUser.name);
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
    });

    test('POST /api/auth/login - wrong password returns 4xx', async ({ request }) => {
      const response = await request.post('/api/auth/login', {
        data: { email: testUser.email, password: 'WrongPassword999!' },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });

    test('POST /api/auth/login - non-existent user returns 4xx', async ({ request }) => {
      const response = await request.post('/api/auth/login', {
        data: { email: 'nonexistent@example.com', password: 'SomePassword123!' },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });

    test('POST /api/auth/login - missing credentials returns 4xx', async ({ request }) => {
      const response = await request.post('/api/auth/login', {
        data: {},
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });
  });

  test.describe('Tasks CRUD', () => {
    let taskAuthToken: string;
    let taskUserId: string;
    let taskId: string;
    let taskRequest: APIRequestContext;

    const taskTestUser = {
      email: `task_user_${Date.now()}@example.com`,
      password: 'TaskUserPass123!',
      name: 'Task Test User',
    };

    test.beforeAll(async ({ playwright }) => {
      taskRequest = await playwright.request.newContext({ baseURL: 'http://localhost:3001' });

      const registerRes = await taskRequest.post('/api/auth/register', {
        data: taskTestUser,
      });
      expect(registerRes.status()).toBe(201);
      const registerBody = await registerRes.json();
      taskAuthToken = registerBody.token;
      taskUserId = registerBody.user.id;
    });

    test.afterAll(async () => {
      await taskRequest.dispose();
    });

    test.describe('POST /api/tasks - Create Task', () => {
      test('should create a task successfully - 201', async () => {
        const taskPayload = {
          title: 'Test Task Title',
          description: 'Test task description',
          priority: 'high',
          dueDate: '2027-12-31T00:00:00.000Z',
        };

        const response = await taskRequest.post('/api/tasks', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: taskPayload,
        });

        expect(response.status()).toBe(201);

        const body = await response.json();
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('title', taskPayload.title);
        expect(body).toHaveProperty('description', taskPayload.description);
        expect(body).toHaveProperty('priority', taskPayload.priority);
        expect(body).toHaveProperty('dueDate');
        expect(body).toHaveProperty('completed');
        expect(body.completed).toBe(false);

        taskId = body.id;
      });

      test('should create a task with minimal fields - 201', async () => {
        const taskPayload = {
          title: 'Minimal Task',
        };

        const response = await taskRequest.post('/api/tasks', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: taskPayload,
        });

        expect(response.status()).toBe(201);

        const body = await response.json();
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('title', taskPayload.title);
      });

      // TC-007
      test('TC-007 - should return 401 when creating task without auth token', async () => {
        const response = await taskRequest.post('/api/tasks', {
          data: {
            title: 'Unauthorized Task',
            description: 'Should not be created',
          },
        });

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      // TC-007
      test('TC-007 - should return 401 when creating task with invalid token', async () => {
        const response = await taskRequest.post('/api/tasks', {
          headers: { Authorization: 'Bearer invalidtoken123' },
          data: {
            title: 'Unauthorized Task',
          },
        });

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      test('should return 4xx when creating task without title', async () => {
        const response = await taskRequest.post('/api/tasks', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: {
            description: 'No title task',
            priority: 'low',
          },
        });

        expect(response.status()).toBeGreaterThanOrEqual(400);
        expect(response.status()).toBeLessThan(500);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });
    });

    test.describe('GET /api/tasks - List Tasks', () => {
      test('should retrieve tasks list - 200', async () => {
        const response = await taskRequest.get('/api/tasks', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(Array.isArray(body)).toBe(true);

        if (body.length > 0) {
          const task = body[0];
          expect(task).toHaveProperty('id');
          expect(task).toHaveProperty('title');
          expect(task).toHaveProperty('completed');
        }
      });

      // TC-007
      test('TC-007 - should return 401 for GET /api/tasks without token', async () => {
        const response = await taskRequest.get('/api/tasks');

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      // TC-007
      test('TC-007 - should return 401 for GET /api/tasks with malformed token', async () => {
        const response = await taskRequest.get('/api/tasks', {
          headers: { Authorization: 'Bearer malformed.token.here' },
        });

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });
    });

    test.describe('GET /api/tasks/:id - Get Single Task', () => {
      test('should retrieve a single task by ID - 200', async () => {
        const response = await taskRequest.get(`/api/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('id', taskId);
        expect(body).toHaveProperty('title');
        expect(body).toHaveProperty('description');
        expect(body).toHaveProperty('priority');
        expect(body).toHaveProperty('completed');
      });

      test('should return 404 for non-existent task ID', async () => {
        const response = await taskRequest.get('/api/tasks/nonexistent-task-id-99999', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(404);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      // TC-007
      test('TC-007 - should return 401 for GET /api/tasks/:id without token', async () => {
        const response = await taskRequest.get(`/api/tasks/${taskId}`);

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });
    });

    test.describe('PUT /api/tasks/:id - Update Task', () => {
      test('should update a task successfully - 200', async () => {
        const updatePayload = {
          title: 'Updated Task Title',
          description: 'Updated description',
          priority: 'medium',
        };

        const response = await taskRequest.put(`/api/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: updatePayload,
        });

        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('id', taskId);
        expect(body).toHaveProperty('title', updatePayload.title);
        expect(body).toHaveProperty('description', updatePayload.description);
        expect(body).toHaveProperty('priority', updatePayload.priority);
      });

      test('should update task dueDate - 200', async () => {
        const updatePayload = {
          dueDate: '2028-06-15T00:00:00.000Z',
        };

        const response = await taskRequest.put(`/api/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: updatePayload,
        });

        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('id', taskId);
        expect(body).toHaveProperty('dueDate');
      });

      test('should return 404 when updating non-existent task', async () => {
        const response = await taskRequest.put('/api/tasks/nonexistent-task-99999', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: { title: 'Updated Title' },
        });

        expect(response.status()).toBe(404);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      // TC-007
      test('TC-007 - should return 401 for PUT /api/tasks/:id without token', async () => {
        const response = await taskRequest.put(`/api/tasks/${taskId}`, {
          data: { title: 'Should not update' },
        });

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      // TC-007
      test('TC-007 - should return 401 for PUT /api/tasks/:id with invalid token', async () => {
        const response = await taskRequest.put(`/api/tasks/${taskId}`, {
          headers: { Authorization: 'Bearer invalidtoken123' },
          data: { title: 'Should not update' },
        });

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });
    });

    test.describe('PATCH /api/tasks/:id/complete - Complete Task', () => {
      test('should mark a task as complete - 200', async () => {
        const response = await taskRequest.patch(`/api/tasks/${taskId}/complete`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('id', taskId);
        expect(body).toHaveProperty('completed', true);
      });

      test('should return 404 when completing non-existent task', async () => {
        const response = await taskRequest.patch('/api/tasks/nonexistent-task-99999/complete', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(404);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      // TC-007
      test('TC-007 - should return 401 for PATCH /api/tasks/:id/complete without token', async () => {
        const response = await taskRequest.patch(`/api/tasks/${taskId}/complete`);

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });
    });

    test.describe('DELETE /api/tasks/:id - Delete Task', () => {
      let deleteTaskId: string;

      test.beforeAll(async () => {
        const createRes = await taskRequest.post('/api/tasks', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: { title: 'Task to Delete', description: 'Will be deleted', priority: 'low' },
        });
        expect(createRes.status()).toBe(201);
        const createBody = await createRes.json();
        deleteTaskId = createBody.id;
      });

      test('should delete a task successfully - 204', async () => {
        const response = await taskRequest.delete(`/api/tasks/${deleteTaskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(204);
      });

      test('should return 404 after deleting the same task again', async () => {
        const response = await taskRequest.delete(`/api/tasks/${deleteTaskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(404);
      });

      test('should return 404 when deleting non-existent task', async () => {
        const response = await taskRequest.delete('/api/tasks/nonexistent-task-99999', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect(response.status()).toBe(404);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });

      // TC-007
      test('TC-007 - should return 401 for DELETE /api/tasks/:id without token', async () => {
        const anotherCreateRes = await taskRequest.post('/api/tasks', {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: { title: 'Protected Task', priority: 'low' },
        });
        expect(anotherCreateRes.status()).toBe(201);
        const anotherBody = await anotherCreateRes.json();
        const protectedTaskId = anotherBody.id;

        const response = await taskRequest.delete(`/api/tasks/${protectedTaskId}`);

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');

        // Verify task still exists (not deleted)
        const verifyRes = await taskRequest.get(`/api/tasks/${protectedTaskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });
        expect(verifyRes.status()).toBe(200);

        // Cleanup
        await taskRequest.delete(`/api/tasks/${protectedTaskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });
      });

      // TC-007
      test('TC-007 - should return 401 for DELETE /api/tasks/:id with invalid token', async () => {
        const response = await taskRequest.delete(`/api/tasks/${taskId}`, {
          headers: { Authorization: 'Bearer invalidtoken123' },
        });

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
      });
    });

    test.describe('Cross-user task isolation', () => {
      let secondUserToken: string;
      let secondUserTaskId: string;

      test.beforeAll(async () => {
        const secondUser = {
          email: `second_user_${Date.now()}@example.com`,
          password: 'SecondUserPass123!',
          name: 'Second User',
        };

        const registerRes = await taskRequest.post('/api/auth/register', {
          data: secondUser,
        });
        expect(registerRes.status()).toBe(201);
        const body = await registerRes.json();
        secondUserToken = body.token;

        const createRes = await taskRequest.post('/api/tasks', {
          headers: { Authorization: `Bearer ${secondUserToken}` },
          data: { title: 'Second user task', priority: 'low' },
        });
        expect(createRes.status()).toBe(201);
        const taskBody = await createRes.json();
        secondUserTaskId = taskBody.id;
      });

      test('first user should not access second user task - 403 or 404', async () => {
        const response = await taskRequest.get(`/api/tasks/${secondUserTaskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect([403, 404]).toContain(response.status());
      });

      test('first user should not update second user task - 403 or 404', async () => {
        const response = await taskRequest.put(`/api/tasks/${secondUserTaskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
          data: { title: 'Hijacked title' },
        });

        expect([403, 404]).toContain(response.status());
      });

      test('first user should not delete second user task - 403 or 404', async () => {
        const response = await taskRequest.delete(`/api/tasks/${secondUserTaskId}`, {
          headers: { Authorization: `Bearer ${taskAuthToken}` },
        });

        expect([403, 404]).toContain(response.status());
      });
    });
  });

  test.describe('Auth - Logout', () => {
    let logoutToken: string;
    let logoutRequest: APIRequestContext;

    const logoutTestUser = {
      email: `logout_user_${Date.now()}@example.com`,
      password: 'LogoutUserPass123!',
      name: 'Logout Test User',
    };

    test.beforeAll(async ({ playwright }) => {
      logoutRequest = await playwright.request.newContext({ baseURL: 'http://localhost:3001' });

      const registerRes = await logoutRequest.post('/api/auth/register', {
        data: logoutTestUser,
      });
      expect(registerRes.status()).toBe(201);
      const body = await registerRes.json();
      logoutToken = body.token;
    });

    test.afterAll(async () => {
      await logoutRequest.dispose();
    });

    test('POST /api/auth/logout - success 200', async () => {
      const response = await logoutRequest.post('/api/auth/logout', {
        headers: { Authorization: `Bearer ${logoutToken}` },
      });

      expect(response.status()).toBe(200);
    });

    test('POST /api/auth/logout - without token returns 401', async () => {
      const response = await logoutRequest.post('/api/auth/logout');

      expect(response.status()).toBe(401);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });

    test('POST /api/auth/logout - with invalid token returns 401', async () => {
      const response = await logoutRequest.post('/api/auth/logout', {
        headers: { Authorization: 'Bearer invalidtoken123' },
      });

      expect(response.status()).toBe(401);

      const body = await response.json();
      expect(body).toHaveProperty('error');
    });
  });

  test.describe('TC-007 - Comprehensive Unauthorized Access Checks', () => {
    const FAKE_TASK_ID = 'fake-task-id-12345';
    const endpoints = [
      { method: 'GET', path: '/api/tasks', label: 'GET /api/tasks' },
      { method: 'GET', path: `/api/tasks/${FAKE_TASK_ID}`, label: 'GET /api/tasks/:id' },
      { method: 'PUT', path: `/api/tasks/${FAKE_TASK_ID}`, label: 'PUT /api/tasks/:id' },
      { method: 'DELETE', path: `/api/tasks/${FAKE_TASK_ID}`, label: 'DELETE /api/tasks/:id' },
      { method: 'PATCH', path: `/api/tasks/${FAKE_TASK_ID}/complete`, label: 'PATCH /api/tasks/:id/complete' },
    ];

    for (const endpoint of endpoints) {
      test(`TC-007 - ${endpoint.label} without token returns 401`, async ({ request }) => {
        let response;

        switch (endpoint.method) {
          case 'GET':
            response = await request.get(endpoint.path);
            break;
          case 'POST':
            response = await request.post(endpoint.path, { data: { title: 'Test' } });
            break;
          case 'PUT':
            response = await request.put(endpoint.path, { data: { title: 'Test' } });
            break;
          case 'DELETE':
            response = await request.delete(endpoint.path);
            break;
          case 'PATCH':
            response = await request.patch(endpoint.path);
            break;
          default:
            throw new Error(`Unknown method: ${endpoint.method}`);
        }

        expect(response.status()).toBe(401);

        const body = await response.json();
        expect(body).toHaveProperty('error');
        expect(typeof body.error).toBe('string');
        expect(body.error.length).toBeGreaterThan(0);
      });
    }

    // TC-007
    test('TC-007 - POST /api/tasks without token returns 401', async ({ request }) => {
      const response = await request.post('/api/tasks', {
        data: {
          title: 'Unauthorized Task',
          description: 'Should not be created',
          priority: 'high',
        },
      });

      expect(response.status()).toBe(401);

      const body = await response.json();
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    });

    // TC-007
    test('TC-007 - All endpoints with expired/malformed token return 401', async ({ request }) => {
      const malformedToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.malformed.payload';

      const getResponse = await request.get('/api/tasks', {
        headers: { Authorization: malformedToken },
      });
      expect(getResponse.status()).toBe(401);
      const getBody = await getResponse.json();
      expect(getBody).toHaveProperty('error');

      const postResponse = await request.post('/api/tasks', {
        headers: { Authorization: malformedToken },
        data: { title: 'Should not create' },
      });
      expect(postResponse.status()).toBe(401);
      const postBody = await postResponse.json();
      expect(postBody).toHaveProperty('error');

      const putResponse = await request.put(`/api/tasks/${FAKE_TASK_ID}`, {
        headers: { Authorization: malformedToken },
        data: { title: 'Should not update' },
      });
      expect(putResponse.status()).toBe(401);
      const putBody = await putResponse.json();
      expect(putBody).toHaveProperty('error');

      const deleteResponse = await request.delete(`/api/tasks/${FAKE_TASK_ID}`, {
        headers: { Authorization: malformedToken },
      });
      expect(deleteResponse.status()).toBe(401);
      const deleteBody = await deleteResponse.json();
      expect(deleteBody).toHaveProperty('error');
    });
  });
});