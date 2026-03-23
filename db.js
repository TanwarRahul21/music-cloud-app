import { supabase } from './supabase.js';

export async function initDb() {
  return Promise.resolve();
}

async function getCurrentUserId() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session?.user?.id ?? null;
}

export async function loadDbTracks() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: true });
  if (error) {
    console.error('Error loading tracks:', error.message);
    return [];
  }

  return data || [];
}

export async function saveDbTrack(track) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('No logged-in user');

  const payload = {
    id: track.id,
    user_id: userId,
    name: track.name,
    size: track.size,
    type: track.type ?? null,
    duration: track.duration ?? null,
    artwork_url: track.artwork_url ?? track.artworkUrl ?? null,
    url: track.url,
    path: track.path ?? null,
    added_at: track.addedAt ? new Date(track.addedAt).toISOString() : new Date().toISOString()
  };

  const { error } = await supabase
    .from('tracks')
    .upsert(payload, { onConflict: 'id' });

  if (error) {
    console.error('Error saving track:', error.message);
    throw error;
  }
}

export async function deleteDbTrack(id) {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase
    .from('tracks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function clearAllDbTracks() {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase
    .from('tracks')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}
