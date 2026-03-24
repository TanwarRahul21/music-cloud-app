import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// TODO: set your Supabase project values
const SUPABASE_URL = "https://qquitczzzdhlswhojphx.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_NF9ocYFvNxWXy0YWNsIUUg_AjkqzKtF";

const safeFetch = async (url, options) => {
  try {
    return await fetch(url, options);
  } catch (err) {
    const requestUrl = typeof url === 'string' ? url : url?.toString?.() ?? '';
    const isRefreshToken = requestUrl.includes('/auth/v1/token')
      && requestUrl.includes('grant_type=refresh_token');
    const isOfflineFetch = err?.name === 'TypeError' && err?.message === 'Failed to fetch';

    if (isRefreshToken && isOfflineFetch) {
      return new Response(
        JSON.stringify({ error: 'offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    throw err;
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: safeFetch },
});

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

export function onAuthState(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return getCurrentUser();
}

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return getCurrentUser();
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
