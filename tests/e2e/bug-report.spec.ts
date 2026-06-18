import { expect, test } from '@playwright/test';

const MOCK_FEEDBACK_SUCCESS = {
  data: { issueNumber: 42, issueUrl: 'https://github.com/dariuszdanowski/bookshelf/issues/42' },
};

test('bug-report — golden path: otwórz modal, wypełnij, wyślij, pokaż link do issue', async ({
  page,
}) => {
  await page.route('**/api/feedback', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_FEEDBACK_SUCCESS),
    }),
  );

  await page.goto('/library');
  // Czekamy na networkidle żeby React zdążył zahydrować island
  await page.waitForLoadState('networkidle');

  const trigger = page.getByTestId('bug-report-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const modal = page.getByTestId('bug-report-modal');
  await expect(modal).toBeVisible();

  await page.getByLabel('Tytuł').fill('Testowy błąd');
  await page.getByLabel('Opis').fill('Opis testowego błędu do weryfikacji E2E.');
  await page.getByTestId('bug-report-submit').click();

  await expect(page.getByText('Zgłoszenie zostało wysłane')).toBeVisible();
  const issueLink = page.getByRole('link', { name: /Zgłoszenie #42/ });
  await expect(issueLink).toBeVisible();
  await expect(issueLink).toHaveAttribute(
    'href',
    'https://github.com/dariuszdanowski/bookshelf/issues/42',
  );

  await expect(modal).not.toBeVisible({ timeout: 4_000 });
});

test('bug-report — walidacja: submit bez tytułu nie zamyka modalu', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');

  await page.getByTestId('bug-report-trigger').click();
  await expect(page.getByTestId('bug-report-modal')).toBeVisible();

  await page.getByLabel('Opis').fill('Opis bez tytułu.');
  await page.getByTestId('bug-report-submit').click();

  await expect(page.getByTestId('bug-report-modal')).toBeVisible();
});

test('bug-report — brak triggera bez auth (wyczyszczone cookies)', async ({ page, context }) => {
  // Usuwamy cookies auth — server zobaczy user=null i nie wyrenderuje island
  await context.clearCookies();
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('bug-report-trigger')).not.toBeAttached();
});
