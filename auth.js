import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// TODO: set your Supabase project values
const SUPABASE_URL = window.env?.SUPABASE_URL || "https://YOUR-SUPABASE-URL.supabase.co";
const SUPABASE_ANON_KEY = window.env?.SUPABASE_ANON_KEY || "YOUR-SUPABASE-ANON-KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
