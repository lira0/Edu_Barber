(() => {
  const cfg = window.BARBERSHOP_CONFIG || {};

  let url = String(cfg.SUPABASE_URL || "").trim();
  const key = String(cfg.SUPABASE_PUBLISHABLE_KEY || "").trim();

  url = url.replace(/\/+$/, "");

  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl =
      parsed.protocol === "https:" &&
      (parsed.hostname.endsWith(".supabase.co") || parsed.hostname.endsWith(".supabase.net"));
  } catch (_) {
    validUrl = false;
  }

  const validKey =
    key.length > 20 &&
    !key.includes("COLE_AQUI") &&
    (key.startsWith("sb_publishable_") || key.startsWith("eyJ"));

  const configured = validUrl && validKey && !url.includes("COLE_AQUI");
  window.SUPABASE_CONFIGURED = configured;

  if (!configured) {
    window.sb = null;
    console.error("Supabase não configurado.", {
      urlInformada: url || "(vazia)",
      urlValida: validUrl,
      chaveInformada: key ? `${key.slice(0, 12)}...` : "(vazia)",
      chaveValida: validKey
    });
    return;
  }

  if (!window.supabase?.createClient) {
    window.sb = null;
    console.error("A biblioteca supabase-js não foi carregada.");
    return;
  }

  window.sb = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  console.log("Supabase configurado com sucesso:", url);
})();
