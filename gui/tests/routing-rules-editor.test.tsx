import { expect, test } from "bun:test";
import { Window } from "happy-dom"; import { act, useState } from "react";
import { LanguageProvider } from "../src/i18n/provider";
import RoutingRulesEditor from "../src/components/RoutingRulesEditor";
import type { RoutingRule } from "../../src/routing/rules";

test("rules can be added, scheduled, reordered and removed using labelled controls", async () => {
 const keys=["document","window","navigator","localStorage","IS_REACT_ACT_ENVIRONMENT"] as const;
 const previous=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));const browser=new Window({url:"http://localhost/"});
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,value:k==="IS_REACT_ACT_ENVIRONMENT"?true:k==="window"?browser:Reflect.get(browser,k)});
 Object.defineProperty(browser.navigator,"language",{configurable:true,value:"en-US"});let current:RoutingRule[]=[];
 function Harness(){const[rules,setRules]=useState<RoutingRule[]>([]);current=rules;return <RoutingRulesEditor rules={rules} candidates={[{provider:"a",model:"m1"}]} onChange={setRules}/>;}
 const{createRoot}=await import("react-dom/client");const host=browser.document.createElement("div");browser.document.body.append(host);const root=createRoot(host);
 const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===text)!;
 try{
 await act(async()=>root.render(<LanguageProvider><Harness/></LanguageProvider>));
 await act(async()=>button("Add rule").click());expect(current).toHaveLength(1);
 await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());expect(current[0]!.when.time?.zone).toBeDefined();
 expect(host.querySelectorAll('button[aria-pressed]')).toHaveLength(7);
 await act(async()=>button("Add rule").click());await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Move rule-2 up"]')!.click());expect(current[0]!.id).toBe("rule-2");
 await act(async()=>button("Remove").click());expect(current).toHaveLength(1);expect(current[0]!.id).toBe("rule-1");
 }finally{await act(async()=>root.unmount());browser.close();for(const k of keys){const d=previous.get(k);if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
