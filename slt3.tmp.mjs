import { chromium } from "playwright";
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const b=await chromium.launch({headless:false,args:["--disable-blink-features=AutomationControlled","--window-position=10000,10000","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows"]});
const ctx=await b.newContext({userAgent:UA,locale:"fr-FR",viewport:{width:1400,height:900}});
const p=await ctx.newPage();
const base="https://www.seloger.com/immobilier/locations/immo-paris-75/bien-appartement/";
async function tryUrl(q){for(let i=0;i<5;i++){try{const r=await p.goto(base+q,{waitUntil:"domcontentloaded",timeout:40000});await p.waitForTimeout(9000);if(r?.status()===200&&(await p.content()).length>200000){return await p.evaluate(()=>{const c=[...document.querySelectorAll("[data-testid='serp-core-classified-card-testid']")];return {n:c.length,prices:c.slice(0,8).map(el=>{const m=el.textContent.match(/([\d\s]+)\s*€\s*\/mois/);return m?parseInt(m[1].replace(/\s/g,'')):null;}).filter(Boolean)};});}await p.waitForTimeout(3000);}catch{await p.waitForTimeout(3000);}}return null;}
for(const q of ["?tri=d_dt_crea","?tri=a_px","?price=NaN%2F1500&tri=d_dt_crea"]){const res=await tryUrl(q);console.log(q,"->",res?JSON.stringify(res):"échec");}
await b.close();
