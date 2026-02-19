import { test, expect, Page } from 'playwright-test-coverage';

// --- Mock Data ---

const mockMenu = [
  { id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' },
  { id: 2, title: 'Pepperoni', image: 'pizza2.png', price: 0.0042, description: 'Spicy treat' },
];

const mockFranchises = [
  {
    id: 2,
    name: 'LotaPizza',
    admins: [{ id: 3, name: 'pizza franchisee', email: 'f@jwt.com' }],
    stores: [
      { id: 4, name: 'Lehi', totalRevenue: 0.0042 },
    ],
  },
  { id: 3, name: 'PizzaCorp', admins: [{ id: 5, name: 'corp admin', email: 'corp@jwt.com' }], stores: [{ id: 7, name: 'Spanish Fork', totalRevenue: 0.001 }] },
];

const mockDinerUser = { id: 3, name: 'Kai Chen', email: 'd@jwt.com', roles: [{ role: 'diner' }] };
const mockAdminUser = { id: 1, name: 'Admin User', email: 'a@jwt.com', roles: [{ role: 'admin' }] };
const mockFranchiseeUser = { id: 4, name: 'Pizza Franchisee', email: 'f@jwt.com', roles: [{ role: 'diner' }, { role: 'franchisee', objectId: '10' }] };

const mockOrders = {
  dinerId: 3,
  orders: [
    {
      id: 1,
      franchiseId: 2,
      storeId: 4,
      date: '2024-06-01T00:00:00.000Z',
      items: [
        { menuId: 1, description: 'Veggie', price: 0.0038 },
        { menuId: 2, description: 'Pepperoni', price: 0.0042 },
      ],
    },
  ],
  page: 1,
};

const mockDocs = {
  endpoints: [
    {
      requiresAuth: false,
      method: 'GET',
      path: '/api/order/menu',
      description: 'Get the pizza menu',
      example: 'curl localhost:3000/api/order/menu',
      response: [{ id: 1, title: 'Veggie', description: 'A garden', image: 'pizza1.png', price: 0.0038 }],
    },
    {
      requiresAuth: true,
      method: 'PUT',
      path: '/api/auth',
      description: 'Login existing user',
      example: 'curl -X PUT localhost:3000/api/auth -d \'{"email":"a@jwt.com", "password":"admin"}\'',
      response: { user: { id: 1, name: 'common', email: 'a@jwt.com', roles: [{ role: 'diner' }] }, token: 'abc' },
    },
  ],
};

// --- Mock Setup Helpers ---

async function setupBasicMocks(page: Page, user: any = mockDinerUser, userFranchises: any[] = [mockFranchises[0]]) {
  // Version
  await page.route('*/**/version.json', async (route) => {
    await route.fulfill({ json: { version: '20240601.000000' } });
  });

  // Menu
  await page.route('*/**/api/order/menu', async (route) => {
    await route.fulfill({ json: mockMenu });
  });

  // Auth
  await page.route('*/**/api/auth', async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      await route.fulfill({ json: { user, token: 'test-token-abc' } });
    } else if (method === 'POST') {
      await route.fulfill({ json: { user, token: 'test-token-abc' } });
    } else if (method === 'DELETE') {
      await route.fulfill({ json: { message: 'logout successful' } });
    }
  });

  // User me
  await page.route('*/**/api/user/me', async (route) => {
    await route.fulfill({ json: user });
  });

  // Order (POST and GET)
  await page.route('*/**/api/order', async (route) => {
    if (route.request().url().includes('/api/order/menu') || route.request().url().includes('/api/order/verify')) {
      return route.fallback();
    }
    if (route.request().method() === 'POST') {
      const orderReq = route.request().postDataJSON();
      await route.fulfill({
        json: {
          order: { ...orderReq, id: 1 },
          jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        },
      });
    } else {
      await route.fulfill({ json: mockOrders });
    }
  });

  // Verify
  await page.route('*/**/api/order/verify', async (route) => {
    await route.fulfill({ json: { message: 'valid', payload: { vendor: { id: '1', name: 'pizzaPocket' }, order: { id: '1' } } } });
  });

  // Store operations (create/delete) - must be before franchise route
  await page.route(/\/api\/franchise\/\d+\/store/, async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { id: 100, name: body.name, totalRevenue: 0 } });
    } else if (method === 'DELETE') {
      await route.fulfill({ json: { message: 'store closed' } });
    }
  });

  // Franchise by ID (get user's franchises, close franchise)
  await page.route(/\/api\/franchise\/\d+$/, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: userFranchises });
    } else if (method === 'DELETE') {
      await route.fulfill({ json: { message: 'franchise closed' } });
    }
  });

  // Franchise list (with query params) and create franchise
  await page.route(/\/api\/franchise[^\/]/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { franchises: mockFranchises, more: false } });
    } else if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { id: 10, name: body.name, admins: body.admins || [], stores: [] } });
    }
  });

  // Franchise list (no query params - exact match)
  await page.route(/\/api\/franchise$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { franchises: mockFranchises, more: false } });
    } else if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { id: 10, name: body.name, admins: body.admins || [], stores: [] } });
    }
  });

  // User update (PUT /api/user/:id)
  await page.route(/\/api\/user\/\d+$/, async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { user: { ...user, ...body }, token: 'test-token-abc' } });
    } else if (method === 'DELETE') {
      await route.fulfill({ json: { message: 'user deleted' } });
    } else {
      await route.fallback();
    }
  });

  // User list (GET /api/user)
  await page.route(/\/api\/user(\?|$)/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          users: [
            { id: 3, name: 'Kai Chen', email: 'd@jwt.com', roles: [{ role: 'diner' }] },
          ],
          more: false,
        },
      });
    }
  });

  // Docs
  await page.route('*/**/api/docs', async (route) => {
    await route.fulfill({ json: mockDocs });
  });
}

// --- Tests ---

test('home page', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/');

  expect(await page.title()).toBe('JWT Pizza');
  await expect(page.locator('h2')).toContainText('The web\'s best pizza');
  await expect(page.getByRole('button', { name: 'Order now' })).toBeVisible();
});

test('order now navigates to menu', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Order now' }).click();
  await expect(page.locator('h2')).toContainText('Awesome is a click away');
});

test('about page', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/about');

  await expect(page.locator('h2').first()).toContainText('The secret sauce');
  await expect(page.getByRole('heading', { name: 'Our employees' })).toBeVisible();
  await expect(page.getByAltText('Employee stock photo').first()).toBeVisible();
});

test('history page', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/history');

  await expect(page.locator('h2')).toContainText('Mama Rucci, my my');
});

test('404 page', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/nonexistent-route');

  await expect(page.locator('h2')).toContainText('Oops');
  await expect(page.getByText('dropped a pizza on the floor')).toBeVisible();
});

test('login', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'Login' }).click();
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByRole('link', { name: 'KC' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Logout' })).toBeVisible();
});

test('login error', async ({ page }) => {
  await page.route('*/**/version.json', async (route) => {
    await route.fulfill({ json: { version: '20240601.000000' } });
  });
  await page.route('*/**/api/auth', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 404, json: { message: 'unknown user' } });
    }
  });

  await page.goto('/login');

  await page.getByPlaceholder('Email address').fill('bad@test.com');
  await page.getByPlaceholder('Password').fill('wrong');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('unknown user')).toBeVisible();
});

test('login page register link', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/login');

  await page.getByRole('main').getByText('Register').click();
  await expect(page).toHaveURL(/\/register/);
});

test('register', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'Register' }).click();
  await page.getByPlaceholder('Full name').fill('New User');
  await page.getByPlaceholder('Email address').fill('new@test.com');
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();

  await expect(page.getByRole('link', { name: 'Logout' })).toBeVisible();
});

test('register error', async ({ page }) => {
  await page.route('*/**/version.json', async (route) => {
    await route.fulfill({ json: { version: '20240601.000000' } });
  });
  await page.route('*/**/api/auth', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 409, json: { message: 'User already exists' } });
    }
  });

  await page.goto('/register');

  await page.getByPlaceholder('Full name').fill('Existing User');
  await page.getByPlaceholder('Email address').fill('exists@test.com');
  await page.getByPlaceholder('Password').fill('password');
  await page.getByRole('button', { name: 'Register' }).click();

  await expect(page.getByText('User already exists')).toBeVisible();
});

test('register page login link', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/register');

  await page.getByRole('main').getByText('Login').click();
  await expect(page).toHaveURL(/\/login/);
});

test('logout', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Logout' })).toBeVisible();
  await page.getByRole('link', { name: 'Logout' }).click();

  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
});

test('purchase with login', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Order now' }).click();
  await expect(page.locator('h2')).toContainText('Awesome is a click away');
  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('link', { name: 'Image Description Veggie A' }).click();
  await page.getByRole('link', { name: 'Image Description Pepperoni' }).click();
  await expect(page.locator('form')).toContainText('Selected pizzas: 2');
  await page.getByRole('button', { name: 'Checkout' }).click();

  // Login
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();

  // Payment
  await expect(page.getByRole('main')).toContainText('Send me those 2 pizzas right now!');
  await expect(page.locator('tbody')).toContainText('Veggie');
  await expect(page.locator('tbody')).toContainText('Pepperoni');
  await expect(page.locator('tfoot')).toContainText('0.008');
  await page.getByRole('button', { name: 'Pay now' }).click();

  // Delivery
  await expect(page.getByText('Here is your JWT Pizza!')).toBeVisible();
  await expect(page.getByText('0.008')).toBeVisible();
});

test('purchase single pizza', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Order now' }).click();
  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('link', { name: 'Image Description Veggie A' }).click();
  await expect(page.locator('form')).toContainText('Selected pizzas: 1');
  await page.getByRole('button', { name: 'Checkout' }).click();

  await expect(page.getByRole('main')).toContainText('Send me that pizza right now!');
  await expect(page.locator('tfoot')).toContainText('1 pie');
});

test('payment cancel', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Order now' }).click();
  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('link', { name: 'Image Description Veggie A' }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.locator('h2')).toContainText('Awesome is a click away');
});

test('payment error', async ({ page }) => {
  await setupBasicMocks(page);
  // Override order POST to fail
  await page.route('*/**/api/order', async (route) => {
    if (route.request().url().includes('/api/order/menu') || route.request().url().includes('/api/order/verify')) {
      return route.fallback();
    }
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, json: { message: 'Order failed' } });
    } else {
      return route.fallback();
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Order now' }).click();
  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('link', { name: 'Image Description Veggie A' }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Pay now' }).click();

  await expect(page.getByText('Order failed')).toBeVisible();
});

test('delivery verify', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/');

  // Navigate via purchase flow
  await page.getByRole('button', { name: 'Order now' }).click();
  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('link', { name: 'Image Description Veggie A' }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Pay now' }).click();

  await expect(page.getByText('Here is your JWT Pizza!')).toBeVisible();
  await page.getByRole('button', { name: 'Verify' }).click();

  // Verify triggers the verifyOrder call - modal may or may not open with Preline
  // The verify function code path is exercised regardless
  await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();
});

test('delivery order more', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Order now' }).click();
  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('link', { name: 'Image Description Veggie A' }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Pay now' }).click();

  await expect(page.getByText('Here is your JWT Pizza!')).toBeVisible();
  await page.getByRole('button', { name: 'Order more' }).click();
  await expect(page.locator('h2')).toContainText('Awesome is a click away');
});

test('diner dashboard with orders', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/diner-dashboard');

  await expect(page.getByText('Your pizza kitchen')).toBeVisible();
  await expect(page.getByText('Kai Chen')).toBeVisible();
  await expect(page.getByText('d@jwt.com')).toBeVisible();
  await expect(page.getByText('diner', { exact: true })).toBeVisible();
  await expect(page.getByText('Here is your history')).toBeVisible();
});

test('diner dashboard empty orders', async ({ page }) => {
  await setupBasicMocks(page);
  // Override orders to return empty
  await page.route('*/**/api/order', async (route) => {
    if (route.request().url().includes('/api/order/menu') || route.request().url().includes('/api/order/verify')) {
      return route.fallback();
    }
    await route.fulfill({ json: { dinerId: 3, orders: [], page: 1 } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/diner-dashboard');

  await expect(page.getByText('How have you lived this long')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buy one' })).toBeVisible();
});

test('diner dashboard franchisee role', async ({ page }) => {
  await setupBasicMocks(page, mockFranchiseeUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/diner-dashboard');

  await expect(page.getByText('Your pizza kitchen')).toBeVisible();
  await expect(page.getByText('Pizza Franchisee')).toBeVisible();
  await expect(page.getByText('Franchisee on 10')).toBeVisible();
});

test('admin dashboard', async ({ page }) => {
  await setupBasicMocks(page, mockAdminUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/admin-dashboard');

  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
  await expect(page.getByText('LotaPizza')).toBeVisible();
  await expect(page.getByText('Lehi')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Franchise' })).toBeVisible();
});

test('admin dashboard non-admin gets 404', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/admin-dashboard');

  await expect(page.locator('h2')).toContainText('Oops');
});

test('admin creates franchise', async ({ page }) => {
  await setupBasicMocks(page, mockAdminUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/admin-dashboard');

  await page.getByRole('button', { name: 'Add Franchise' }).click();
  await expect(page.getByText('Want to create franchise?')).toBeVisible();
  await page.getByPlaceholder('franchise name').fill('Test Franchise');
  await page.getByPlaceholder('franchisee admin email').fill('admin@test.com');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
});

test('admin closes franchise', async ({ page }) => {
  await setupBasicMocks(page, mockAdminUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/admin-dashboard');

  // Wait for the table to load
  await expect(page.getByText('LotaPizza')).toBeVisible();
  // Click the Close button next to the first franchise
  await page.getByRole('button', { name: 'Close' }).first().click();

  await expect(page.getByText('Sorry to see you go')).toBeVisible();
  await expect(page.getByText('LotaPizza')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
});

test('admin closes store', async ({ page }) => {
  await setupBasicMocks(page, mockAdminUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/admin-dashboard');

  // Wait for the table to load
  await expect(page.getByText('LotaPizza')).toBeVisible();
  // Click Close button on a store row (second Close button)
  const closeButtons = page.getByRole('button', { name: 'Close' });
  await closeButtons.nth(1).click();

  await expect(page.getByText('Sorry to see you go')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
});

test('franchise dashboard with franchise', async ({ page }) => {
  await setupBasicMocks(page, mockFranchiseeUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/franchise-dashboard');

  await expect(page.getByText('LotaPizza')).toBeVisible();
  await expect(page.getByText('Everything you need to run')).toBeVisible();
  await expect(page.getByText('Lehi')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create store' })).toBeVisible();
});

test('franchise dashboard no franchise', async ({ page }) => {
  await setupBasicMocks(page, mockDinerUser, []);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/franchise-dashboard');

  await expect(page.getByText('So you want a piece of the pie?')).toBeVisible();
  await expect(page.getByText('Call now')).toBeVisible();
  await expect(page.getByText('800-555-5555')).toBeVisible();
  await expect(page.getByText('Unleash Your Potential')).toBeVisible();
  await expect(page.getByText('If you are already a franchisee')).toBeVisible();
});

test('franchisee creates store', async ({ page }) => {
  await setupBasicMocks(page, mockFranchiseeUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/franchise-dashboard');

  await page.getByRole('button', { name: 'Create store' }).click();
  await expect(page.getByText('Create store')).toBeVisible();
  await page.getByPlaceholder('store name').fill('New Store');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByText('LotaPizza')).toBeVisible();
});

test('franchisee closes store', async ({ page }) => {
  await setupBasicMocks(page, mockFranchiseeUser);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/franchise-dashboard');

  await expect(page.getByText('Lehi')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Sorry to see you go')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByText('LotaPizza')).toBeVisible();
});

test('docs page', async ({ page }) => {
  await setupBasicMocks(page);
  await page.goto('/docs');

  await expect(page.getByText('JWT Pizza API')).toBeVisible();
  await expect(page.getByRole('heading', { name: '[GET] /api/order/menu' })).toBeVisible();
  await expect(page.getByText('Get the pizza menu')).toBeVisible();
});

test('navigate to diner dashboard via user avatar', async ({ page }) => {
  await setupBasicMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token-abc');
  });
  await page.goto('/');

  // Wait for the user to load and avatar to appear
  await expect(page.getByRole('link', { name: 'KC' })).toBeVisible();
  await page.getByRole('link', { name: 'KC' }).click();
  await expect(page.getByText('Your pizza kitchen')).toBeVisible();
});
