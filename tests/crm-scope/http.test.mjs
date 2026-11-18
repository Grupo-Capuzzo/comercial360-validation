import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
const require=createRequire(import.meta.url);
function compile(source, imports) {
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function("require","exports",js)(name=>imports[name]??require(name),exports);return exports;
}
const scope=compile(await readFile(new URL("../../src/lib/crm/scope.ts",import.meta.url),"utf8"),{});
const http=compile(await readFile(new URL("../../src/lib/commercial/http.ts",import.meta.url),"utf8"),{"./journey":{rule:(condition,code)=>{if(!condition)throw new Error(code);}}});
class PortalError extends Error { constructor(status,code){super(code);this.status=status;this.code=code;} }
const source=await readFile(new URL("../../src/app/api/crm/[escopo]/route.ts",import.meta.url),"utf8");
function route(access) {return compile(source,{
 "@/services/crm-scope.server":{requireCrmScope:access,crmDatabaseError:error=>{throw new PortalError(error?.code==="42501"?403:503,"crm_scope_forbidden");}},
 "@/services/portal.service":{PortalError},"@/lib/crm/scope":scope,"@/lib/commercial/http":http,
});}
const context={params:Promise.resolve({escopo:"cred"})};
const request=(body,origin="http://localhost:3999")=>new Request("http://localhost:3999/api/crm/cred",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
test("scope parser rejects traversal and malformed UUIDs",()=>{for(const value of ["../crm","","ether","0000-0000-0000-0000-0000000000000000"])assert.equal(scope.validScope(value),false);for(const value of ["geral","cred","ethernexus","20000000-0000-4000-8000-000000000001"])assert.equal(scope.validScope(value),true);});
test("page parser never allows negative or exponential offsets",()=>{assert.equal(scope.parsePage(null),0);assert.equal(scope.parsePage("2"),2);for(const value of ["-1","1e2","0.5","1000000"])assert.throws(()=>scope.parsePage(value));});
test("API denies unauthorized GET with 403 and private no-store",async()=>{const response=await route(async()=>{throw new PortalError(403,"crm_scope_forbidden");}).GET(new Request("http://localhost/api/crm/cred?kind=opportunities"),context);assert.equal(response.status,403);assert.match(response.headers.get("cache-control"),/no-store/);assert.deepEqual(await response.json(),{code:"crm_scope_forbidden"});});
test("API denies unauthorized POST before executing RPC",async()=>{let called=false;const response=await route(async()=>{called=true;throw new PortalError(403,"crm_scope_forbidden");}).POST(request({action:"crm_concluir_tarefa",payload:{tarefa_id:"foreign"}}),context);assert.equal(called,true);assert.equal(response.status,403);});
test("API returns mapping pending instead of empty global data",async()=>{const response=await route(async()=>({context:{mapped:false},db:null})).GET(new Request("http://localhost/api/crm/cred?kind=opportunities"),context);assert.equal(response.status,409);});
test("API enforces kind allowlist before DB execution",async()=>{const response=await route(async()=>({context:{mapped:true},db:null})).GET(new Request("http://localhost/api/crm/cred?kind=auth.users"),context);assert.equal(response.status,400);});
test("API blocks cross-origin writes and read-only profiles",async()=>{const db={schema(){throw new Error("must_not_call_db");}};const read=route(async()=>({context:{mapped:true,can_write:false},db}));assert.equal((await read.POST(request({action:"lead_status",payload:{}}),context)).status,403);const prior=process.env.COMMERCIAL_PUBLIC_ORIGIN;try{process.env.COMMERCIAL_PUBLIC_ORIGIN="http://localhost:3999";const write=route(async()=>({context:{mapped:true,can_write:true},db}));assert.equal((await write.POST(request({action:"lead_status",payload:{}},"http://attacker.invalid"),context)).status,400);}finally{if(prior===undefined)delete process.env.COMMERCIAL_PUBLIC_ORIGIN;else process.env.COMMERCIAL_PUBLIC_ORIGIN=prior;}});
test("API returns DB denial and hides database diagnostics",async()=>{const endpoint=route(async()=>({context:{mapped:true},db:{schema:()=>({rpc:async()=>({error:{code:"42501",message:"sensitive diagnostic"}})})}}));const response=await endpoint.GET(new Request("http://localhost/api/crm/cred?kind=tasks"),context);assert.equal(response.status,403);assert.equal((await response.text()).includes("sensitive"),false);});
test("proxy rejects unauthorized direct company URL with actual HTTP 403",async()=>{const {NextRequest}=require("next/server");const src=await readFile(new URL("../../src/lib/supabase/proxy.ts",import.meta.url),"utf8");let scopeSent;const exports=compile(src,{
 "@supabase/ssr":{createServerClient:()=>({auth:{getClaims:async()=>({data:{claims:{sub:"synthetic"}}})},schema:()=>({rpc:async(name,args)=>{scopeSent=args.p_escopo;return {error:{code:"42501"}};}})})},
 "@/lib/supabase/config":{supabaseConfig:{url:"http://localhost:54321",publishableKey:"synthetic"}},
 "@/erp/core/diagnostico-assessoria":{diagnosticoAssessoria:()=>null},
});const response=await exports.updateSession(new NextRequest("http://localhost/comercial/ethernexus?empresa=cred"));assert.equal(response.status,403);assert.equal(scopeSent,"ethernexus");assert.match(response.headers.get("cache-control"),/no-store/);});
test("proxy preserves public password recovery paths without CRM calls",async()=>{const {NextRequest}=require("next/server");const src=await readFile(new URL("../../src/lib/supabase/proxy.ts",import.meta.url),"utf8");const exports=compile(src,{
 "@supabase/ssr":{createServerClient:()=>{throw new Error("auth_client_must_not_be_created");}},
 "@/lib/supabase/config":{supabaseConfig:{}},
 "@/erp/core/diagnostico-assessoria":{diagnosticoAssessoria:()=>null},
});for(const path of ["/forgot-password","/reset-password"]){const response=await exports.updateSession(new NextRequest("http://localhost"+path));assert.equal(response.status,200);}});
