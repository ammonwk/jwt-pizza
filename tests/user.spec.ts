import { test, expect, Page } from 'playwright-test-coverage';

const mockMenu = [
  { id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' },
];

const mockDinerUser = { id: 3, name: 'pizza diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] };
const mockAdminUser = { id: 1, name: 'Admin User', email: 'a@jwt.com', roles: [{ role: 'admin' }] };

const mockOrders = {
  dinerId: 3,
  orders: [],
  page: 1,
};

const mockUsers = {
  users: [
    { id: 3, name: 'pizza diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] },
    { id: 4, name: 'test user', email: 't@jwt.com', roles: [{ role: 'diner' }] },
  ],
  more: false,
};

const mockFranchises = [
  {
    id: 2,
    name: 'LotaPizza',
    admins: [{ id: 3, name: 'pizza franchisee', email: 'f@jwt.com' }],
    stores: [{ id: 4, name: 'Lehi', totalRevenue: 0.0042 }],
  },
];

async function setupMocks(page: Page, user: any = mockDinerUser) {
  await page.route('*/**/version.json', async (route) => {
    await route.fulfill({ json: { version: '20240601.000000' } });
  });

  await page.route('*/**/api/order/menu', async (route) => {
    await route.fulfill({ json: mockMenu });
  });

  let currentUser = { ...user };

  await page.route('*/**/api/auth', async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      await route.fulfill({ json: { user: currentUser, token: 'test-token-abc' } });
    } else if (method === 'POST') {
      const body = route.request().postDataJSON();
      currentUser = { ...currentUser, name: body.name, email: body.email };
      await route.fulfill({ json: { user: currentUser, token: 'test-token-abc' } });
    } else if (method === 'DELETE') {
      await route.fulfill({ json: { message: 'logout successful' } });
    }
  });

  await page.route('*/**/api/user/me', async (route) => {
    await route.fulfill({ json: currentUser });
  });

  await page.route(/\/api\/user\/\d+$/, async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      const body = route.request().postDataJSON();
      currentUser = { ...currentUser, name: body.name, email: body.email };
      await route.fulfill({ json: { user: currentUser, token: 'test-token-abc' } });
    } else if (method === 'DELETE') {
      await route.fulfill({ json: { message: 'user deleted' } });
    }
  });

  await page.route(/\/api\/user(\?|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: mockUsers });
    }
  });

  await page.route('*/**/api/order', async (route) => {
    if (route.request().url().includes('/api/order/menu')) {
      return route.fallback();
    }
    await route.fulfill({ json: mockOrders });
  });

  await page.route(/\/api\/franchise[^\/]/, async (route) => {
    await route.fulfill({ json: { franchises: mockFranchises, more: false } });
  });

  await page.route(/\/api\/franchise$/, async (route) => {
    await route.fulfill({ json: { franchises: mockFranchises, more: false } });
  });

  await page.route(/\/api\/franchise\/\d+$/, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.route('*/**/api/docs', async (route) => {
    await route.fulfill({ json: { endpoints: [] } });
  });
}

test('update user - open and close dialog', async ({ page }) => {
  await setupMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/diner-dashboard');

  await expect(page.getByRole('main')).toContainText('pizza diner');

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('h3')).toContainText('Edit user');
  await page.getByRole('button', { name: 'Update' }).click();

  await page.waitForSelector('[role="dialog"].hidden', { state: 'attached' });

  await expect(page.getByRole('main')).toContainText('pizza diner');
});

test('update user - change name', async ({ page }) => {
  await setupMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/diner-dashboard');

  await expect(page.getByRole('main')).toContainText('pizza diner');

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('h3')).toContainText('Edit user');
  await page.getByRole('textbox').first().fill('pizza dinerx');
  await page.getByRole('button', { name: 'Update' }).click();

  await page.waitForSelector('[role="dialog"].hidden', { state: 'attached' });

  await expect(page.getByRole('main')).toContainText('pizza dinerx');
});

test('admin dashboard shows users list', async ({ page }) => {
  await setupMocks(page, mockAdminUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/admin-dashboard');

  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
  await expect(page.getByText('Users')).toBeVisible();
  await expect(page.getByText('pizza diner')).toBeVisible();
  await expect(page.getByText('d@jwt.com')).toBeVisible();
  await expect(page.getByText('test user')).toBeVisible();
});

test('admin dashboard delete user', async ({ page }) => {
  let deletedUserId: string | null = null;
  await setupMocks(page, mockAdminUser);

  // Override user delete route to track which user was deleted
  await page.route(/\/api\/user\/\d+$/, async (route) => {
    if (route.request().method() === 'DELETE') {
      const url = route.request().url();
      deletedUserId = url.split('/').pop() || null;
      await route.fulfill({ json: { message: 'user deleted' } });
    } else {
      await route.fallback();
    }
  });

  // After delete, return filtered list
  await page.route(/\/api\/user(\?|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      const filteredUsers = mockUsers.users.filter((u) => String(u.id) !== deletedUserId);
      await route.fulfill({ json: { users: filteredUsers, more: false } });
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/admin-dashboard');

  await expect(page.getByText('test user')).toBeVisible();
  // Click the Delete button for the second user
  const deleteButtons = page.getByRole('button', { name: 'Delete' });
  await deleteButtons.nth(1).click();

  await expect(page.getByText('test user')).not.toBeVisible();
});
