// Real services only. Credentials and URL are injected by the isolated runner.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 const failures=[];page.on('pageerror',e=>failures.push(e.message));
 await page.goto(process.env.EPIC5_BROWSER_URL,{waitUntil:'domcontentloaded'});
 await page.getByLabel('Username',{exact:true}).fill('operator');
 await page.getByLabel('Password',{exact:true}).fill(process.env.EPIC5_TEST_PASSWORD);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByText('Signed in as',{exact:false}).waitFor({timeout:20000});
 const rail=page.getByRole('complementary',{name:'Command center operational action rail'});
 const modify=rail.getByRole('button',{name:'Modify',exact:true});
 await modify.waitFor({timeout:45000});
 await modify.click({timeout:20000});
 const submit=rail.getByRole('button',{name:'Confirm Modification & Apply',exact:false});
 assert(await submit.isDisabled(),'reason must be deliberately chosen');
 await rail.getByLabel('Modification reason category').selectOption('Field observation');
 await rail.getByLabel('Modification details and justification').fill('Preserve through actual network loss');
 await context.setOffline(true);
 await page.waitForTimeout(3500);
 assert.equal(await rail.getByLabel('Modification details and justification').inputValue(),'Preserve through actual network loss');
 assert(await submit.isDisabled(),'offline decision disabled');
 await context.setOffline(false);
 await page.reload({waitUntil:'domcontentloaded'});
 await rail.getByLabel('Modification details and justification').waitFor({timeout:45000});
 assert.equal(await rail.getByLabel('Modification details and justification').inputValue(),'Preserve through actual network loss');
 // The persisted draft remains reviewable after reload. It must never auto-submit.
 assert.equal(await rail.getByLabel('Modification reason category').inputValue(),'Field observation');
 assert.equal(failures.length,0,failures.join('\n'));
 await page.screenshot({path:'.runtime/epic5-real-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'.runtime/epic5-real-mobile.png',fullPage:true});
 console.log('PASS real browser: authenticated session, explicit reason, offline gating, draft preservation and reload; no page errors');
 await context.close();
} finally {await browser.close()}
