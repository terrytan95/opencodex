import { expect, test } from "bun:test";
import { Window } from "happy-dom";import { act } from "react";
import { clearClientResourceStoresForTests } from "../src/client-resource";
import { LanguageProvider } from "../src/i18n/provider";
import ScenariosPage from "../src/pages/integrations/ScenariosPage";

test("preview is read-only until explicit apply and displays per-client confirmation", async () => {
 const keys=["document","window","navigator","localStorage","IS_REACT_ACT_ENVIRONMENT"] as const;
 const previous=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));const originalFetch=globalThis.fetch;const browser=new Window({url:"http://localhost/"});
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,value:k==="IS_REACT_ACT_ENVIRONMENT"?true:k==="window"?browser:Reflect.get(browser,k)});
 Object.defineProperty(browser.navigator,"language",{configurable:true,value:"en-US"});clearClientResourceStoresForTests();let applied=0;
 globalThis.fetch=(async(input,init)=>{const url=String(input);if(url.endsWith('/preview'))return Response.json({id:'fixture',name:'Work',fingerprint:'a'.repeat(64),clients:[{client:'codex',changes:[{key:'model',before:'old-model',after:'new-model'}],restartRequired:true}]});
 if(url.endsWith('/apply')){expect(JSON.parse(String(init?.body))).toEqual({id:'fixture',fingerprint:'a'.repeat(64)});applied++;return Response.json({clients:[{client:'codex',status:'applied',restartRequired:true}]});}
 return Response.json({scenarios:[{id:'fixture',name:'Work',clients:{codex:{model:'new-model'}}}],current:[{client:'codex',available:true,settings:{model:'old-model'}}]});}) as typeof fetch;
 const{createRoot}=await import("react-dom/client");const host=browser.document.createElement('div');browser.document.body.append(host);const root=createRoot(host);
 const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
 const flush=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,20));});};
 try{await act(async()=>root.render(<LanguageProvider><ScenariosPage apiBase="http://fixture" active/></LanguageProvider>));await flush();
 await act(async()=>button('Preview').click());await flush();expect(applied).toBe(0);expect(host.textContent).toContain('old-model');expect(host.textContent).toContain('new-model');
 await act(async()=>button('Apply changes').click());await flush();expect(applied).toBe(1);expect(host.textContent).toContain('Applied');expect(host.textContent).toContain('Restart client');
 }finally{await act(async()=>root.unmount());clearClientResourceStoresForTests();globalThis.fetch=originalFetch;browser.close();for(const k of keys){const d=previous.get(k);if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
