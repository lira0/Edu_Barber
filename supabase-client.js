(() => {
  const cfg = window.BARBERSHOP_CONFIG || {};
  const url = String(cfg.SUPABASE_URL || "").trim();
  const key = String(cfg.SUPABASE_PUBLISHABLE_KEY || "").trim();

  const configured =
    /^https:\/\/.+\.supabase\.co$/i.test(url) &&
    key.length > 20 &&
    !url.includes("COLE_AQUI") &&
    !key.includes("COLE_AQUI");

  window.SUPABASE_CONFIGURED = configured;

  if (!configured) {
    window.sb = null;
    console.warn("Supabase não configurado. Preencha config.js.");
    return;
  }

  if (!window.supabase?.createClient) {
    window.sb = null;
    console.error("supabase-js não foi carregado.");
    return;
  }

  window.sb = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
})();
