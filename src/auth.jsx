// ─── Auth: real accounts via Supabase Auth ──────────────────────────────────
// Wraps the whole app. Tracks the signed-in session, loads the matching
// Profiles row (display name, player tag, premium flag), and exposes sign-in /
// sign-up / sign-out plus a profile updater. Google + Discord OAuth and
// email/password all land here. Premium status is read-only from the client —
// it's locked server-side (see the accounts_profiles_and_auth migration).

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./appCore";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Global login modal — any component can pop it via openAuth().
  const [authModal, setAuthModal] = useState(null); // null | "signin" | "signup"

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const { data } = await supabase.from("Profiles").select("*").eq("id", userId).maybeSingle();
    setProfile(data || null);
  }, []);

  useEffect(() => {
    // Initial session (also picks up an OAuth/email redirect landing in the URL).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadProfile(data.session?.user?.id).finally(() => setLoading(false));
    });
    // React to sign-in / sign-out / token refresh across tabs.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      loadProfile(s?.user?.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const user = session?.user || null;

  const redirectTo = typeof window !== "undefined" ? window.location.origin + "/tournaments/profile" : undefined;

  const value = {
    user,
    profile,
    loading,
    isPremium: !!profile?.is_premium,

    authModal,
    openAuth: (mode = "signin") => setAuthModal(mode),
    closeAuth: () => setAuthModal(null),

    signInWithPassword: (email, password) =>
      supabase.auth.signInWithPassword({ email, password }),

    signUpWithPassword: (email, password, displayName) =>
      supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: displayName || null }, emailRedirectTo: redirectTo },
      }),

    signInWithOAuth: (provider) =>
      supabase.auth.signInWithOAuth({ provider, options: { redirectTo } }),

    signOut: () => supabase.auth.signOut(),

    // Client may edit display_name / player_tag / avatar only; is_premium/email
    // are stripped by a DB trigger even if sent.
    updateProfile: async (patch) => {
      if (!user) return { error: { message: "NOT_SIGNED_IN" } };
      const res = await supabase.from("Profiles").update(patch).eq("id", user.id).select().maybeSingle();
      if (!res.error && res.data) setProfile(res.data);
      return res;
    },

    refreshProfile: () => loadProfile(user?.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
