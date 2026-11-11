import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
async function settled(page: Page) { await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false'); }
const huge='1457749797599807020288895183510966368466165358906132257739200124470589079634';
const keys=(page:string='1')=>`/?view=keys&page=${page}`;
const mnemonics='/?view=mnemonics';
test('large private-key page switches to mnemonic page one without crashing', async ({page, appUrl})=>{
 await page.goto(appUrl(keys(huge))); await expect(page.locator('.row-permalink')).toHaveCount(20); await settled(page);
 await page.getByRole('button',{name:'Mnemonic seeds',exact:true}).click();
 await expect(page.locator('.row-permalink').first()).toHaveText('Mnemonic#0');
 await expect(page.locator('.row-permalink')).toHaveCount(20); await settled(page);
 await page.getByRole('button',{name:'Private keys',exact:true}).click();
 await expect(page.locator('.row-permalink').first()).toHaveText('Private key#0'); await settled(page);
});
for(const url of [keys(),mnemonics]) {
 test(`pagination and detail links ${url}`,async({page, appUrl})=>{
  await page.goto(appUrl(url)); await expect(page.locator('.row-permalink').last()).toContainText('#19'); await settled(page);
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.row-permalink').first()).toContainText('#20'); await settled(page);
  const href=await page.locator('.row-permalink').first().getAttribute('href');
  await page.goto(href!); await expect(page.locator('.row-permalink').first()).toContainText('#20'); await settled(page);
  await page.reload(); await expect(page.locator('.row-permalink')).toHaveCount(20); await settled(page);
  await page.locator('.detail-link').first().click();
  await expect(page.locator('main')).toBeVisible(); await expect(page.locator('header')).toBeVisible(); await expect(page.locator('footer')).toBeVisible();
  if (url.includes('view=keys')) await expect(page.locator('.detail-card').last().locator('.detail-value').last()).toContainText(/Opened|Unopened/);
  else { await expect(page.locator('.row')).toHaveCount(20); await settled(page); }
 });
 test(`final partial page ${url}`,async({page, appUrl})=>{
  await page.goto(appUrl(url)); await expect(page.locator('.row-permalink')).toHaveCount(20); await settled(page);
  await page.getByRole('button',{name:'Last',exact:true}).click();
  await expect(page.locator('.row-permalink')).toHaveCount(16); await settled(page);
 });
 test(`CSV download ${url}`,async({page, appUrl})=>{
  await page.goto(appUrl(url)); await expect(page.locator('.row-permalink')).toHaveCount(20); await settled(page);
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Export as .csv'}).click();
  expect((await download).suggestedFilename()).toMatch(/page-1-.*\.csv$/);
 });
}
test('shrinking mnemonic namespace keeps valid rows',async({page, appUrl})=>{
 await page.goto(appUrl(mnemonics)); await page.locator('#word-count').selectOption('24');
 await page.getByRole('button',{name:'Last',exact:true}).click(); await expect(page.locator('.row-permalink')).toHaveCount(16); await settled(page);
 await page.locator('#word-count').selectOption('12');
 await expect(page.locator('.row-permalink').first()).toHaveText('Mnemonic#340282366920938463463374607431768211440'); await settled(page);
});
test('mnemonic account pagination and key destination',async({page, appUrl})=>{
 await page.goto(appUrl('/?view=mnemonics&entry=0&detail=mnemonic'));
 await expect(page.locator('.row')).toHaveCount(20); await settled(page);
 await expect(page.getByRole('link',{name:'Account #0',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByRole('link',{name:'Account #20',exact:true})).toBeVisible(); await settled(page);
 await page.getByRole('link',{name:'Account #20',exact:true}).click();
 await expect(page.getByText('Nano private key',{exact:true})).toBeVisible();
 await expect(page.locator('.detail-card').last().locator('.detail-value').last()).toContainText(/Opened|Unopened/);
});

test('recorded ledger state is normalized consistently', async ({page, appUrl}) => {
 await page.goto(appUrl(keys()));
 await expect(page.locator('.row-permalink')).toHaveCount(20);
 await settled(page);
 // These are snapshots of the recorded key indexes 0–19, not live ledger assertions.
 await expect(page.locator('.state--error')).toHaveCount(0);
 await expect(page.locator('.state--opened')).toHaveCount(4);
 await expect(page.locator('.balance-pill[title="0 raw"]')).toHaveCount(20);
});
