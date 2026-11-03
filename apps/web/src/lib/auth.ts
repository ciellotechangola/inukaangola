import { createClientServer } from "./supabase-server";
import { Profile } from "@/types";

export async function getSession() {
  const supabase = await createClientServer();
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session;
}

export async function getUser() {
  const supabase = await createClientServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClientServer();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .single();
  if (error) return null;
  return data as Profile;
}

export async function signOut() {
  const supabase = await createClientServer();
  await supabase.auth.signOut();
}
