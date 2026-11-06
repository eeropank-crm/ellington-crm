'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs');
const {render,VIDEO_URL,THUMBNAIL_URL}=require('../server/services/mail-content');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:900,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const body='Tere!\n\nSoovin tutvustada Ellingtoni võimalusi.\nVaata meie videot: '+VIDEO_URL+'\n\nKas leiaksime sobiva aja teie vajaduste arutamiseks?\n\nParimate soovidega\nEllington';
  const html=render({body,purpose:'Video tutvustus'}).html;
  // Network access to YouTube is restricted here. Use a clearly labelled test
  // image to check layout, never substitute it in the real sent message.
  const fixture='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#e9eef8"/><text x="240" y="170" text-anchor="middle" font-size="24" fill="#1f4d93">Sünteetiline pisipilt</text><text x="240" y="210" text-anchor="middle" font-size="16" fill="#17243b">Paigutuse test — mitte video tegelik kaader</text></svg>';
  await page.route('**/*',route=>route.request().url()===THUMBNAIL_URL?route.fulfill({status:200,contentType:'image/svg+xml',body:fixture}):route.abort());
  fs.mkdirSync('docs/video-email-preview',{recursive:true});
  await page.setContent(html);await page.locator('img').waitFor();await page.waitForFunction(()=>document.querySelector('img').complete);
  assert.equal(await page.locator('img').evaluate(e=>e.getBoundingClientRect().width),480);
  assert.equal(await page.locator('a').count(),2);assert.equal(await page.locator('img').evaluate(e=>e.parentElement.href),VIDEO_URL);
  assert.equal(await page.getByRole('link',{name:/Vaata videot YouTube/}).getAttribute('href'),VIDEO_URL);
  await page.screenshot({path:'docs/video-email-preview/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.ok(await page.locator('img').evaluate(e=>e.getBoundingClientRect().width)<=358);
  await page.screenshot({path:'docs/video-email-preview/mobile.png',fullPage:true});
  await page.unroute('**/*');await page.route('**/*',route=>route.abort());
  await page.setContent(html);await page.getByRole('link',{name:/Vaata videot YouTube/}).waitFor();
  await page.screenshot({path:'docs/video-email-preview/images-blocked.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS Chromium: 480px desktop, responsive mobile, both links, images-blocked fallback, no JS errors; synthetic thumbnail; no mail sent.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
