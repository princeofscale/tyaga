import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.use({
  locale: 'ru-RU',
  timezoneId: 'Europe/Saratov',
  trace: 'off',
  screenshot: 'off',
});

const VISIT_TAG = process.env.TYAGA_AGENT_VISIT || 'po-v2-r01-20261114-second';
const EVIDENCE_ROOT = path.resolve(process.cwd(), 'artifacts/agent-evolution/product-visits', VISIT_TAG);

// Synthetic disposable local credentials (process memory only, never logged or dumped)
const OWN_DISPLAY_NAME = 'PRODUCT PO v2';
const OWN_EMAIL = 'product-po-v2@local.invalid';
const OWN_LOCAL_PASS = 'ProductOwnerV2_Local2026!';

interface ControlInventoryItem {
  tag: string;
  role: string;
  type: string;
  text: string;
  ariaLabel: string;
  placeholder: string;
  inputMode: string;
  value: string;
  name: string;
  rect: { width: number; height: number; x: number; y: number };
  focused: boolean;
  disabled: boolean;
}

interface StepSnapshot {
  step: string;
  project: string;
  url: string;
  timestamp: string;
  inventory: ControlInventoryItem[];
  screenshotFile: string;
  ariaSnapshot?: string;
}

async function captureStep(page: Page, projectName: string, stepName: string): Promise<StepSnapshot> {
  const screenshotDir = path.join(EVIDENCE_ROOT, 'screenshots');
  const inventoryDir = path.join(EVIDENCE_ROOT, 'inventory');
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(inventoryDir, { recursive: true });

  const safeStep = stepName.replace(/[^a-z0-9_-]/gi, '_');
  const screenshotFile = `screenshots/${projectName}-${safeStep}.png`;
  const screenshotPath = path.join(EVIDENCE_ROOT, screenshotFile);

  // Mask sensitive inputs (credentials) in screenshots
  const sensitiveLocators: Locator[] = [
    page.locator('input[type="password"]'),
    page.locator('input[name="password"]'),
    page.locator('input[type="email"]'),
    page.locator('input[name="email"]'),
  ];

  const visibleMasks: Locator[] = [];
  for (const loc of sensitiveLocators) {
    try {
      if ((await loc.count()) > 0 && (await loc.first().isVisible())) {
        visibleMasks.push(loc.first());
      }
    } catch {}
  }

  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      mask: visibleMasks.length > 0 ? visibleMasks : undefined,
    });
  } catch (err) {
    console.error(`[spec] Screenshot failed for ${stepName}:`, (err as Error).message);
  }

  const inventory: ControlInventoryItem[] = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [role="tab"], [role="link"], [role="checkbox"], h1, h2, h3, h4'
      )
    );
    return candidates
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const type = (el as HTMLInputElement).type || '';
        const name = (el as HTMLInputElement).name || '';
        const placeholder = (el as HTMLInputElement).placeholder || '';
        const inputMode = (el as HTMLInputElement).inputMode || '';
        let val = (el as HTMLInputElement).value || '';

        // Redact credentials
        if (
          type === 'password' ||
          name.toLowerCase().includes('password') ||
          name.toLowerCase().includes('email') ||
          placeholder.toLowerCase().includes('парол') ||
          placeholder.toLowerCase().includes('почт')
        ) {
          val = '[REDACTED_CREDENTIAL]';
        }

        return {
          tag,
          role: el.getAttribute('role') || '',
          type,
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder,
          inputMode,
          value: val,
          name,
          rect: {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          },
          focused: document.activeElement === el,
          disabled: (el as HTMLButtonElement).disabled || false,
        };
      });
  });

  // Safe ARIA snapshot if available
  let ariaSnapshotText = '';
  try {
    ariaSnapshotText = await page.locator('body').ariaSnapshot();
  } catch {}

  const snapshot: StepSnapshot = {
    step: stepName,
    project: projectName,
    url: page.url(),
    timestamp: new Date().toISOString(),
    inventory,
    screenshotFile,
    ariaSnapshot: ariaSnapshotText || undefined,
  };

  const inventoryPath = path.join(inventoryDir, `${projectName}-${safeStep}.json`);
  fs.writeFileSync(inventoryPath, JSON.stringify(snapshot, null, 2), 'utf8');

  // Also append to actions log
  const logPath = path.join(EVIDENCE_ROOT, 'actions.jsonl');
  fs.appendFileSync(
    logPath,
    JSON.stringify({
      timestamp: snapshot.timestamp,
      project: projectName,
      step: stepName,
      url: snapshot.url,
      controlCount: inventory.length,
      screenshot: screenshotFile,
    }) + '\n',
    'utf8'
  );

  return snapshot;
}

test.beforeEach(async ({ page }, testInfo) => {
  // Safety guard: abort non-local network traffic
  await page.route('**/*', (route) => {
    try {
      const url = new URL(route.request().url());
      if (
        url.hostname === '127.0.0.1' ||
        url.hostname === 'localhost' ||
        url.protocol === 'data:' ||
        url.protocol === 'blob:'
      ) {
        return route.continue();
      }
      const blockedLog = path.join(EVIDENCE_ROOT, 'safety-guards.log');
      fs.appendFileSync(
        blockedLog,
        `[${new Date().toISOString()}] Aborted external URL: ${route.request().method()} ${route.request().url()}\n`,
        'utf8'
      );
      return route.abort();
    } catch {
      return route.continue();
    }
  });

  // Safe browser console logging (redacting any credentials)
  page.on('console', (msg) => {
    let text = msg.text();
    text = text.replace(new RegExp(OWN_LOCAL_PASS, 'g'), '[REDACTED_PASS]');
    text = text.replace(new RegExp(OWN_EMAIL, 'g'), '[REDACTED_EMAIL]');
    const consoleLog = path.join(EVIDENCE_ROOT, 'browser-console.log');
    fs.appendFileSync(
      consoleLog,
      `[${new Date().toISOString()}] [${testInfo.project.name}] ${msg.type()}: ${text}\n`,
      'utf8'
    );
  });

  // Browser page errors
  page.on('pageerror', (err) => {
    const errorLog = path.join(EVIDENCE_ROOT, 'browser-errors.log');
    fs.appendFileSync(
      errorLog,
      `[${new Date().toISOString()}] [${testInfo.project.name}] ERROR: ${err.message}\n${err.stack || ''}\n`,
      'utf8'
    );
  });

  // Safe network responses (redact auth request/response bodies)
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/')) {
      const networkLog = path.join(EVIDENCE_ROOT, 'network.jsonl');
      const safeRecord = {
        timestamp: new Date().toISOString(),
        project: testInfo.project.name,
        method: res.request().method(),
        url: new URL(url).pathname,
        status: res.status(),
      };
      fs.appendFileSync(networkLog, JSON.stringify(safeRecord) + '\n', 'utf8');
    }
  });
});

test('user workflow exploration and exercise interaction', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000); // Bounded <= 120s per project
  const projectName = testInfo.project.name;
  let tracingStarted = false;

  try {
    // 1. Initial Session Check before any UI actions
    const initialSessionRes = await page.request.get('/api/auth/session');
    expect(initialSessionRes.status()).toBe(200);
    const initialSession = await initialSessionRes.json().catch(() => null);

    // Save initial session state
    fs.writeFileSync(
      path.join(EVIDENCE_ROOT, `initial-session-${projectName}.json`),
      JSON.stringify(
        {
          status: initialSessionRes.status(),
          registered: initialSession?.registered ?? false,
          hasProfile: !!initialSession?.profile,
          displayName: initialSession?.profile?.displayName ?? null,
        },
        null,
        2
      ),
      'utf8'
    );

    // 2. Open root page
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await captureStep(page, projectName, '01-initial-screen');

    // 3. UI Authentication: Disposable Synthetic Account Creation or Login
    let currentSession = initialSession;
    if (!currentSession?.registered || !currentSession?.profile) {
      // Screen should show Registration or Login form
      const regTab = page.locator('button').filter({ hasText: /^Регистрация$/i }).first();
      const loginTab = page.locator('button').filter({ hasText: /^Вход$/i }).first();

      // Check if registration fields are visible
      const nameInput = page.locator('input[name="displayName"], input[placeholder*="Твоё имя" i]').first();
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="you@example.com" i]').first();
      const passInput = page.locator('input[type="password"], input[name="password"]').first();

      if ((await nameInput.count()) > 0 && (await nameInput.isVisible())) {
        // We are on Registration tab: create disposable account
        await nameInput.click();
        await nameInput.pressSequentially(OWN_DISPLAY_NAME, { delay: 30 });

        await emailInput.click();
        await emailInput.pressSequentially(OWN_EMAIL, { delay: 30 });

        await passInput.click();
        await passInput.pressSequentially(OWN_LOCAL_PASS, { delay: 30 });

        await captureStep(page, projectName, '02-auth-registration-filled');

        const submitBtn = page.locator('button[type="submit"], button').filter({ hasText: /Создать аккаунт/i }).first();
        expect(await submitBtn.isVisible()).toBe(true);

        const responsePromise = page.waitForResponse(
          (res) => res.url().includes('/api/') && res.request().method() === 'POST',
          { timeout: 15000 }
        ).catch(() => null);

        await submitBtn.click();
        await responsePromise;
        await page.waitForTimeout(1200);
      } else if ((await loginTab.count()) > 0 && (await loginTab.isVisible())) {
        // Try login tab
        await loginTab.click();
        await page.waitForTimeout(500);

        const loginEmail = page.locator('input[type="email"], input[name="email"]').first();
        const loginPass = page.locator('input[type="password"], input[name="password"]').first();
        const loginSubmit = page.locator('button[type="submit"], button').filter({ hasText: /Войти/i }).first();

        if ((await loginEmail.count()) > 0 && (await loginEmail.isVisible())) {
          await loginEmail.click();
          await loginEmail.pressSequentially(OWN_EMAIL, { delay: 30 });

          await loginPass.click();
          await loginPass.pressSequentially(OWN_LOCAL_PASS, { delay: 30 });

          await captureStep(page, projectName, '02-auth-login-filled');

          const responsePromise = page.waitForResponse(
            (res) => res.url().includes('/api/') && res.request().method() === 'POST',
            { timeout: 15000 }
          ).catch(() => null);

          await loginSubmit.click();
          await responsePromise;
          await page.waitForTimeout(1200);
        }
      }
    }

    // 4. Verify authenticated session identity after UI auth
    const authSessionRes = await page.request.get('/api/auth/session');
    expect(authSessionRes.status()).toBe(200);
    const authSession = await authSessionRes.json().catch(() => null);

    const safeSessionIdentity = {
      status: authSessionRes.status(),
      registered: authSession?.registered,
      profile: authSession?.profile
        ? {
            id: authSession.profile.id,
            displayName: authSession.profile.displayName,
            timeZone: authSession.profile.timeZone,
          }
        : null,
      verifiedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(EVIDENCE_ROOT, `session-identity.json`),
      JSON.stringify(safeSessionIdentity, null, 2),
      'utf8'
    );

    // Owner identity guard: must be our own synthetic account
    if (authSession?.profile?.displayName && authSession.profile.displayName !== OWN_DISPLAY_NAME) {
      throw new Error(`Foreign profile detected: ${authSession.profile.displayName}. Aborting to protect state.`);
    }

    // Start manual action/screenshot trace AFTER UI auth
    await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
    tracingStarted = true;

    await captureStep(page, projectName, '03-authenticated-home');

    // 5. Navigation Survey & Controls Discovery
    const navItems = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll('nav a, nav button, footer a, footer button, [role="tab"], [role="navigation"] a, [role="navigation"] button')
      );
      return links.map((el) => ({
        text: (el.textContent || '').trim().replace(/\s+/g, ' '),
        ariaLabel: el.getAttribute('aria-label') || '',
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        href: el.getAttribute('href') || '',
      }));
    });

    fs.writeFileSync(
      path.join(EVIDENCE_ROOT, `nav-discovery-${projectName}.json`),
      JSON.stringify(navItems, null, 2),
      'utf8'
    );

    // Survey visible sections (programs, progress, tools, profile)
    const sectionsToProbe = ['программ', 'прогресс', 'инструмент', 'истори', 'журнал', 'профил'];
    for (const query of sectionsToProbe) {
      const navBtn = page.locator(`nav button, nav a, [role="tab"]`).filter({ hasText: new RegExp(query, 'i') }).first();
      if ((await navBtn.count()) > 0 && (await navBtn.isVisible())) {
        await navBtn.click();
        await page.waitForTimeout(600);
        await captureStep(page, projectName, `04-nav-${query}`);

        if (query === 'профил') {
          // Test Escape to close profile modal if opened
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }
    }

    // Desktop keyboard evidence (Tab and Enter)
    if (projectName.includes('desktop')) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await captureStep(page, projectName, '05-desktop-keyboard');
    }

    // Return to main/workout starting screen
    const homeNav = page.locator(`nav button, nav a, [role="tab"]`).filter({ hasText: /сегодня|главная|старт|журнал/i }).first();
    if ((await homeNav.count()) > 0 && (await homeNav.isVisible())) {
      await homeNav.click();
      await page.waitForTimeout(500);
    }
    await captureStep(page, projectName, '06-return-to-workout-start');

    // 6. Real Workout Path: Genuinely NEW workout with unique title
    const uniqueWorkoutTitle = `PRODUCT-v2 po-v2-r01-20261114-second ${projectName}`;

    // Find start workout button
    const startButton = page.locator('button, a, [role="button"]').filter({
      hasText: /начать|новая тренировка|старт|быстрый старт|\+ тренировка/i,
    }).first();

    let started = false;
    if ((await startButton.count()) > 0 && (await startButton.isVisible())) {
      await captureStep(page, projectName, '07-before-start-click');
      await startButton.click();
      started = true;
      await page.waitForTimeout(1000);
    } else {
      const plusBtn = page.locator('button[aria-label*="тренировк" i], button[aria-label*="старт" i], button[aria-label*="добавить" i]').first();
      if ((await plusBtn.count()) > 0 && (await plusBtn.isVisible())) {
        await plusBtn.click();
        started = true;
        await page.waitForTimeout(1000);
      }
    }

    await captureStep(page, projectName, '08-workout-screen');
    expect(started).toBe(true);

    // Enter unique title if title field exists
    const titleInput = page.locator('input[placeholder*="название" i], input[placeholder*="тренировк" i], input[aria-label*="название" i]').first();
    if ((await titleInput.count()) > 0 && (await titleInput.isVisible())) {
      await titleInput.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await titleInput.pressSequentially(uniqueWorkoutTitle, { delay: 25 });
      await page.waitForTimeout(300);
      await captureStep(page, projectName, '09-title-entered');
    }

    // 7. Exercise Search & Selection: search "жим"
    const addExerciseBtn = page.locator('button, [role="button"]').filter({
      hasText: /добавить упражнение|выбрать упражнение|упражнение|\+ упр/i,
    }).first();

    if ((await addExerciseBtn.count()) > 0 && (await addExerciseBtn.isVisible())) {
      await addExerciseBtn.click();
      await page.waitForTimeout(800);
      await captureStep(page, projectName, '10-exercise-picker-opened');

      const searchInput = page.locator('input[type="search"], input[placeholder*="поиск" i], input[placeholder*="найти" i], input[type="text"]').first();
      if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
        await searchInput.click();
        await searchInput.pressSequentially('жим', { delay: 40 });
        await page.waitForTimeout(600);
        await captureStep(page, projectName, '11-exercise-search-results');
      }

      // Choose genuinely visible bench press / "жим" label
      const exerciseOption = page.locator('button, [role="button"], li, div[tabindex="0"]').filter({
        hasText: /жим|лежа|присед|тяга/i,
      }).first();

      if ((await exerciseOption.count()) > 0 && (await exerciseOption.isVisible())) {
        const chosenLabel = ((await exerciseOption.textContent()) || '').trim().replace(/\s+/g, ' ');
        fs.writeFileSync(
          path.join(EVIDENCE_ROOT, `chosen-exercise-${projectName}.txt`),
          `Chosen exercise: ${chosenLabel}\n`,
          'utf8'
        );
        await exerciseOption.click();
        await page.waitForTimeout(800);
        await captureStep(page, projectName, '12-exercise-selected');
      }
    }

    // 8. Numeric typing: 40kg 10reps RIR2 -> corrected to 42.5kg 8reps RIR1
    // Identify actual weight/reps/RIR inputs by labels/placeholders, excluding search/title/timer
    const numericInputs = page.locator('input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"], input[type="text"]').filter({
      hasNot: page.locator('input[placeholder*="поиск" i]'),
    }).filter({
      hasNot: page.locator('input[placeholder*="название" i]'),
    });

    const inputCount = await numericInputs.count();
    const inputMappingRecord: Array<{ index: number; placeholder: string; ariaLabel: string; value: string }> = [];

    for (let i = 0; i < inputCount; i++) {
      const inp = numericInputs.nth(i);
      inputMappingRecord.push({
        index: i,
        placeholder: (await inp.getAttribute('placeholder')) || '',
        ariaLabel: (await inp.getAttribute('aria-label')) || '',
        value: await inp.inputValue(),
      });
    }

    fs.writeFileSync(
      path.join(EVIDENCE_ROOT, `numeric-inputs-${projectName}.json`),
      JSON.stringify(inputMappingRecord, null, 2),
      'utf8'
    );

    if (inputCount >= 2) {
      const firstInput = numericInputs.nth(0);
      const secondInput = numericInputs.nth(1);

      // Initial: 40kg, 10 reps, RIR 2
      await firstInput.click();
      await page.keyboard.press('Meta+A');
      await firstInput.pressSequentially('40', { delay: 40 });

      await secondInput.click();
      await page.keyboard.press('Meta+A');
      await secondInput.pressSequentially('10', { delay: 40 });

      if (inputCount >= 3) {
        const thirdInput = numericInputs.nth(2);
        await thirdInput.click();
        await page.keyboard.press('Meta+A');
        await thirdInput.pressSequentially('2', { delay: 40 });
      }

      await captureStep(page, projectName, '13-set-values-initial');

      // Corrected: 42.5kg, 8 reps, RIR 1
      await firstInput.click();
      await page.keyboard.press('Meta+A');
      await firstInput.pressSequentially('42.5', { delay: 40 });

      await secondInput.click();
      await page.keyboard.press('Meta+A');
      await secondInput.pressSequentially('8', { delay: 40 });

      if (inputCount >= 3) {
        const thirdInput = numericInputs.nth(2);
        await thirdInput.click();
        await page.keyboard.press('Meta+A');
        await thirdInput.pressSequentially('1', { delay: 40 });
      }

      await captureStep(page, projectName, '14-set-values-corrected');

      // Record typed values
      const recordedValues = {
        weight: await firstInput.inputValue(),
        reps: await secondInput.inputValue(),
        rir: inputCount >= 3 ? await numericInputs.nth(2).inputValue() : null,
      };
      fs.writeFileSync(
        path.join(EVIDENCE_ROOT, `recorded-set-values-${projectName}.json`),
        JSON.stringify(recordedValues, null, 2),
        'utf8'
      );
    }

    // 9. Mark set completed via actual row's visible checkbox/label
    const setCheckBtn = page.locator('button[aria-label*="выполн" i], button[aria-label*="готов" i], button[aria-label*="check" i], button[role="checkbox"], input[type="checkbox"]').filter({
      hasNotText: /назад|завершить|сохранить|добавить/i,
    }).first();

    if ((await setCheckBtn.count()) > 0 && (await setCheckBtn.isVisible())) {
      await setCheckBtn.click();
      await page.waitForTimeout(600);
      await captureStep(page, projectName, '15-set-marked-done');
    }

    // 10. Rest timer inspection (+30/pause if visible)
    await page.waitForTimeout(500);
    await captureStep(page, projectName, '16-rest-timer-inspection');

    // 11. Add approach / second set
    const addSetBtn = page.locator('button').filter({ hasText: /добавить подход|добавить сет|\+ подход|\+ сет/i }).first();
    if ((await addSetBtn.count()) > 0 && (await addSetBtn.isVisible())) {
      await addSetBtn.click();
      await page.waitForTimeout(600);
      await captureStep(page, projectName, '17-second-set-added');
    }

    // 12. Draft navigation / reload comparison
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await captureStep(page, projectName, '18-draft-after-reload');

    // 13. Save / Finish workout and capture response
    const finishBtn = page.locator('button, [role="button"]').filter({
      hasText: /завершить|сохранить|готово|сохранить тренировку/i,
    }).first();

    if ((await finishBtn.count()) > 0 && (await finishBtn.isVisible())) {
      const responsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/') && (res.request().method() === 'POST' || res.request().method() === 'PUT'),
        { timeout: 15000 }
      ).catch(() => null);

      await finishBtn.click();
      await page.waitForTimeout(800);

      // Confirm dialog if visible
      const confirmBtn = page.locator('button').filter({ hasText: /да|завершить|подтвердить|сохранить/i }).first();
      if ((await confirmBtn.count()) > 0 && (await confirmBtn.isVisible())) {
        await confirmBtn.click();
      }

      const saveRes = await responsePromise;
      if (saveRes) {
        const resBody = await saveRes.json().catch(() => null);
        fs.writeFileSync(
          path.join(EVIDENCE_ROOT, `save-response-${projectName}.json`),
          JSON.stringify(
            {
              url: saveRes.url(),
              status: saveRes.status(),
              body: resBody,
            },
            null,
            2
          ),
          'utf8'
        );
      }
    }

    await captureStep(page, projectName, '19-after-save');

    // 14. History verification & reopen
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const historyNav = page.locator('nav a, nav button, [role="tab"]').filter({ hasText: /журнал|истори/i }).first();
    if ((await historyNav.count()) > 0 && (await historyNav.isVisible())) {
      await historyNav.click();
      await page.waitForTimeout(800);
    }
    await captureStep(page, projectName, '20-history-after-save');

    // 15. Mobile narrow viewport test (360x800)
    if (projectName.includes('mobile')) {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.waitForTimeout(500);
      await captureStep(page, projectName, '21-mobile-narrow-360x800');
    }

  } catch (error) {
    console.error(`[spec] Test encountered error on ${projectName}:`, (error as Error).message);
    try {
      await captureStep(page, projectName, 'error-failure-state');
    } catch {}
    throw error;
  } finally {
    if (tracingStarted) {
      try {
        await context.tracing.stop({
          path: path.join(EVIDENCE_ROOT, `trace-${projectName}.zip`),
        });
      } catch (err) {
        console.error(`[spec] Failed to save trace for ${projectName}:`, (err as Error).message);
      }
    }
  }
});
