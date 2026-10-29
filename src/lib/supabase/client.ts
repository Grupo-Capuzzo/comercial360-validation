import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isSupabaseConfigured, supabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

let browserClient: SupabaseClient<Database> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase não configurado. Preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  browserClient ??= createBrowserClient<Database>(
    supabaseConfig.url,
    supabaseConfig.publishableKey,
    {
      auth: {
        // Recovery is explicitly exchanged once by the reset page.
        detectSessionInUrl: typeof window !== "undefined" && window.location.pathname !== "/reset-password",
      },
    },
  );

  return browserClient;
}
