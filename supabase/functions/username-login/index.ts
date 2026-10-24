// Optional future Edge Function. Not required by current MVP.
// Implement username -> auth user lookup here using service-role credentials stored
// ONLY as Supabase Edge Function secrets. Never ship service_role to the browser.
// Before enabling, add rate limiting and avoid exposing email addresses in responses.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

Deno.serve(async () => new Response(
  JSON.stringify({ error: 'Username login is not enabled in this MVP. Use email + password.' }),
  { status: 501, headers: { 'Content-Type': 'application/json' } },
))
