import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  cloud: {
    distribution: { 'amazon:us:ashburn': { loadZone: 'amazon:us:ashburn', percent: 100 } },
    apm: [],
  },
  thresholds: {},
  scenarios: {
    Scenario_1: {
      executor: 'ramping-vus',
      gracefulStop: '30s',
      stages: [
        { target: 5, duration: '30s' },
        { target: 15, duration: '1m' },
        { target: 10, duration: '30s' },
        { target: 0, duration: '30s' },
      ],
      gracefulRampDown: '30s',
      exec: 'default',
    },
  },
};

export default function () {
  // Login
  let loginRes = http.put(
    'https://pizza-service.ammonkunzler.com/api/auth',
    JSON.stringify({ email: 'loadtester@test.com', password: 'loadtester123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(loginRes, { 'login status was 200': (r) => r.status === 200 });
  const authToken = loginRes.json().token;

  // Get menu
  let menuRes = http.get('https://pizza-service.ammonkunzler.com/api/order/menu');
  check(menuRes, { 'menu status was 200': (r) => r.status === 200 });

  // Buy pizza
  let orderRes = http.post(
    'https://pizza-service.ammonkunzler.com/api/order',
    JSON.stringify({
      franchiseId: 1,
      storeId: 1,
      items: [{ menuId: 1, description: 'Veggie', price: 0.0038 }],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    }
  );
  check(orderRes, { 'order status was 200': (r) => r.status === 200 });
  const pizzaJwt = orderRes.json().jwt;

  // Verify pizza JWT
  let verifyRes = http.post(
    'https://pizza-factory.cs329.click/api/order/verify',
    JSON.stringify({ jwt: pizzaJwt }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(verifyRes, { 'verify status was 200': (r) => r.status === 200 });

  sleep(1);
}
