import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://qquitczzzdhlswhojphx.supabase.co";
const supabaseKey = "sb_publishable_NF9ocYFvNxWXy0YWNsIUUg_AjkqzKtF";

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function signInWithPassword(email, password) {
	const { data, error } = await supabase.auth.signInWithPassword({ email, password });
	if (error) throw error;
	return data;
}

export async function signUpWithPassword(email, password) {
	const { data, error } = await supabase.auth.signUp({ email, password });
	if (error) throw error;
	return data;
}

export async function signOutUser() {
	const { error } = await supabase.auth.signOut();
	if (error) throw error;
}

export function onAuthStateChange(callback) {
	return supabase.auth.onAuthStateChange((event, session) => {
		callback(event, session);
	});
}

export async function getCurrentSession() {
	const { data, error } = await supabase.auth.getSession();
	if (error) throw error;
	return data?.session ?? null;
}