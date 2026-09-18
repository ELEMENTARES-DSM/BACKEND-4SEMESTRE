import { test, expect } from '@playwright/test';

test.describe('Health Check do Playwright', () => {
  test('Deve validar que a estrutura de testes está funcionando', async () => {
    expect(true).toBe(true);
  });
});