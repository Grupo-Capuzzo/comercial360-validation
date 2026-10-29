import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
const source = await readFile(new URL('../src/lib/supabase/password-recovery.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { validateRecoverySession, recoveryErrorMessage, passwordRecoveryRedirect } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
function authFixture({ event = 'PASSWORD_RECOVERY', session = { access_token: 'test-only' }, userError = null, initializeError = null, deferred = false } = {}) {
  let listener;
  const calls = { getUser: 0, exchanges: 0, unsubscribed: false };
  return { calls, auth: {
    onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() { calls.unsubscribed = true; } } } }; },
    async exchangeCodeForSession() { calls.exchanges++; if (!initializeError) { if (deferred) await new Promise(resolve => setTimeout(resolve,0)); listener(event, session); } return { data: { session, user: session ? { id: 'test-user' } : null }, error: initializeError }; },
    async getSession() { return { data: { session }, error: null }; },
    async getUser() { calls.getUser++; return { data: { user: userError ? null : { id: 'test-user' } }, error: userError }; },
  } };
}
const link = new URL('http://localhost:3100/reset-password?code=test-only');
test('redirect local exato', () => assert.equal(passwordRecoveryRedirect, 'http://localhost:3100/reset-password'));
test('recovery exige evento e valida usuario no Auth', async () => { const client = authFixture(); assert.equal(await validateRecoverySession(client, link), 'test-user'); assert.equal(client.calls.getUser, 1); assert.ok(client.calls.unsubscribed); });
test('sessao de login comum nao libera recuperacao', async () => { const client = authFixture({ event: 'SIGNED_IN' }); await assert.rejects(validateRecoverySession(client, link), { code: 'validation_failed' }); assert.equal(client.calls.getUser, 0); assert.ok(client.calls.unsubscribed); });
test('sem link nao reutiliza sessao existente', async () => { await assert.rejects(validateRecoverySession(authFixture(), new URL('http://localhost:3100/reset-password')), { name: 'AuthSessionMissingError' }); });
test('sem sessao bloqueia troca', async () => { await assert.rejects(validateRecoverySession(authFixture({ session: null }), link), { name: 'AuthSessionMissingError' }); });
test('sessao revogada no Auth bloqueia troca', async () => { const client = authFixture({ userError: { code: 'session_not_found' } }); await assert.rejects(validateRecoverySession(client, link), { code: 'session_not_found' }); assert.ok(client.calls.unsubscribed); });
test('link expirado trata fragmento sem expor detalhes', async () => { await assert.rejects(validateRecoverySession(authFixture(), new URL('http://localhost:3100/reset-password#error=access_denied&error_code=otp_expired')), { code: 'otp_expired' }); assert.match(recoveryErrorMessage({ code: 'otp_expired' }), /expirou/); });
test('erro PKCE nao libera formulario', async () => { await assert.rejects(validateRecoverySession(authFixture({ initializeError: { code: 'bad_code_verifier' } }), link), { code: 'bad_code_verifier' }); });
test('senha fraca possui orientacao segura', () => assert.match(recoveryErrorMessage({ code: 'weak_password', message: 'secret-internal' }), /Senha fraca/));
test('falha de rede e limite de envio sao tratados', () => { assert.match(recoveryErrorMessage(new TypeError('fetch failed')), /comunicação/); assert.match(recoveryErrorMessage({ code: 'over_email_send_rate_limit' }), /Aguarde/); });
test('evento diferido pelo SDK libera recovery validada', async () => { const client = authFixture({ deferred: true }); assert.equal(await validateRecoverySession(client, link), 'test-user'); });
test('SDK oficial: email PKCE, validacao, updateUser e signOut local (API simulada)', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const storageData = new Map();
  const requests = [];
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  const token = { access_token: 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url') + '.test', refresh_token: 'test-only', token_type: 'bearer', expires_in: 3600, user };
  const client = createClient('https://test-only.supabase.co', 'test-only-public-key', {
    auth: { flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'recovery-contract', storage: { getItem: key => storageData.get(key) ?? null, setItem: (key,value) => storageData.set(key,value), removeItem: key => storageData.delete(key) } },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(String(init.body)) : null;
      requests.push({ path: url.pathname, query: url.searchParams, method: init.method ?? 'GET', body });
      if (url.pathname.endsWith('/recover')) return Response.json({});
      if (url.pathname.endsWith('/token')) return Response.json(token);
      if (url.pathname.endsWith('/user')) return Response.json(user);
      if (url.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
      throw new Error('Unexpected mocked Auth endpoint');
    } },
  });
  const requested = await client.auth.resetPasswordForEmail(user.email, { redirectTo: passwordRecoveryRedirect });
  assert.equal(requested.error, null);
  const emailRequest = requests.find(r => r.path.endsWith('/recover'));
  assert.equal(emailRequest.query.get('redirect_to'), 'http://localhost:3100/reset-password');
  assert.equal(emailRequest.body.email, user.email);
  assert.ok(emailRequest.body.code_challenge);
  const adapter = { auth: {
    onAuthStateChange: client.auth.onAuthStateChange.bind(client.auth),
    exchangeCodeForSession: client.auth.exchangeCodeForSession.bind(client.auth),
    getSession: client.auth.getSession.bind(client.auth),
    getUser: client.auth.getUser.bind(client.auth),
  } };
  assert.equal(await validateRecoverySession(adapter, link), user.id);
  assert.equal((await client.auth.updateUser({ password: 'Test-only-never-real-123!' })).error, null);
  assert.ok(requests.some(r => r.method === 'PUT' && r.path.endsWith('/user')));
  assert.equal((await client.auth.signOut({ scope: 'local' })).error, null);
  assert.equal(requests.find(r => r.path.endsWith('/logout')).query.get('scope'), 'local');
});
// All test endpoints are simulated: no real code, user or password is consumed.
test('chamadas concorrentes e repetidas consomem o codigo uma vez', async () => {
  const client = authFixture({ deferred: true });
  assert.deepEqual(await Promise.all([validateRecoverySession(client,link),validateRecoverySession(client,link)]), ['test-user','test-user']);
  assert.equal(await validateRecoverySession(client,link),'test-user');
  assert.equal(client.calls.exchanges,1);
});
test('falha de rede nao dispara segunda tentativa de consumo', async () => {
  const client=authFixture({ initializeError: { name:'AuthRetryableFetchError',status:0 } });
  await assert.rejects(validateRecoverySession(client,link));
  await assert.rejects(validateRecoverySession(client,link));
  assert.equal(client.calls.exchanges,1);
});
test('codigo expirado, usado, sessao ausente e rede possuem mensagens distintas', () => {
  const messages=[{code:'flow_state_expired'},{code:'flow_state_not_found'},{name:'AuthSessionMissingError'},new TypeError('network')].map(recoveryErrorMessage);
  assert.equal(new Set(messages).size,4);
  assert.match(messages[0],/expirou/); assert.match(messages[1],/utilizado/); assert.match(messages[2],/inexistente/); assert.match(messages[3],/comunicação/);
});

test('sessao recuperada usa os mesmos cookies no browser SSR e no servidor', async () => {
  const { createBrowserClient, createServerClient } = await import('@supabase/ssr');
  const jar = new Map();
  let exchanges = 0;
  const user = { id: '22222222-2222-4222-8222-222222222222', aud:'authenticated', role:'authenticated', email:'test@example.invalid', app_metadata:{provider:'email'}, user_metadata:{}, created_at:new Date().toISOString() };
  const session = {access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test',refresh_token:'test-only',expires_in:3600,token_type:'bearer',user};
  const mockFetch=async input => {
    const path=new URL(String(input)).pathname;
    if(path.endsWith('/recover'))return Response.json({});
    if(path.endsWith('/token')){exchanges++;return Response.json(session);}
    if(path.endsWith('/user'))return Response.json(user);
    throw Error('Unexpected test-only endpoint');
  };
  const cookies={getAll:()=>Array.from(jar,([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>value?jar.set(name,value):jar.delete(name))};
  const options={cookies,auth:{autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:mockFetch}};
  const browser=createBrowserClient('https://test-ssr.supabase.co','test-public-key',{...options,isSingleton:false});
  assert.equal((await browser.auth.resetPasswordForEmail(user.email,{redirectTo:passwordRecoveryRedirect})).error,null);
  assert.ok(jar.size>0);
  await Promise.all([validateRecoverySession(browser,link),validateRecoverySession(browser,link)]);
  assert.equal(exchanges,1);
  const server=createServerClient('https://test-ssr.supabase.co','test-public-key',options);
  const verified=await server.auth.getUser();
  assert.equal(verified.error,null);assert.equal(verified.data.user.id,user.id);
});

test('producao usa o dominio oficial e nunca localhost por padrao', () => {
  const moduleUrl='data:text/javascript;base64,'+Buffer.from(js).toString('base64');
  const result=spawnSync(process.execPath,['--input-type=module','-e','const m=await import('+JSON.stringify(moduleUrl)+');console.log(m.passwordRecoveryRedirect)'],{encoding:'utf8',env:{...process.env,NODE_ENV:'production',NEXT_PUBLIC_PASSWORD_RESET_REDIRECT_URL:''}});
  assert.equal(result.status,0);assert.equal(result.stdout.trim(),'https://portal.grupocapuzzo.com.br/reset-password');
});
