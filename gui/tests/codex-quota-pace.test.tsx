import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { clearClientResourceStoresForTests } from "../src/client-resource";
import { LanguageProvider } from "../src/i18n/provider";
import CodexQuotaPace from "../src/components/CodexQuotaPace";

test("quota history loads only on expansion and preserves unavailable evidence", async () => {
 const keys=["document","window","navigator","localStorage","IS_REACT_ACT_ENVIRONMENT"] as const;
 const previous=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const originalFetch=globalThis.fetch; const browser=new Window({url:"http://localhost/"});
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,value:k==="IS_REACT_ACT_ENVIRONMENT"?true:k==="window"?browser:Reflect.get(browser,k)});
 Object.defineProperty(browser.navigator,"language",{configurable:true,value:"en-US"});
 clearClientResourceStoresForTests();let requests=0;
 globalThis.fetch=(async()=>{requests++;return Response.json({observations:[]});}) as typeof fetch;
 const {createRoot}=await import("react-dom/client");const host=browser.document.createElement("div");browser.document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(LanguageProvider,null,createElement(CodexQuotaPace,{apiBase:"http://pace-fixture",accountId:"a",plan:"plus",quota:{updatedAt:Date.now(),weeklyPercent:50,weeklyResetAt:Date.now()+2*3600000}}))));
  expect(requests).toBe(0);
  await act(async()=>{host.querySelector("details")!.open=true;host.querySelector("details")!.dispatchEvent(new browser.Event("toggle"));});
  await act(async()=>{await new Promise(r=>setTimeout(r,25));});
  expect(requests).toBe(1);expect(host.textContent).toContain("25.0% per hour");expect(host.textContent).toContain("Not enough recent observations");
 } finally {await act(async()=>root.unmount());clearClientResourceStoresForTests();globalThis.fetch=originalFetch;browser.close();for(const k of keys){const d=previous.get(k);if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
