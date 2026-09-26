(() => {
  const cfg = window.BARBERSHOP_CONFIG || {};

  let url = String(cfg.SUPABASE_URL || "").trim();
  const key = String(cfg.SUPABASE_PUBLISHABLE_KEY || "").trim();

  // Remove barras no final da URL
  // Exemplo:
  // https://xxxx.supabase.co/
  // vira:
  // https://xxxx.supabase.co
  url = url.replace(/\/+$/, "");

  let validUrl = false;

  try {
    const parsed = new URL(url);

    validUrl =
      parsed.protocol === "https:" &&
      (
        parsed.hostname.endsWith(".supabase.co") ||
        parsed.hostname.endsWith(".supabase.net")
      );
  } catch (error) {
    validUrl = false;
  }

  // Aceita:
  // chave nova: sb_publishable_...
  // chave antiga anon: eyJ...
  const validKey =
    key.length > 20 &&
    !key.includes("COLE_AQUI") &&
    (
      key.startsWith("sb_publishable_") ||
      key.startsWith("eyJ")
    );

  const configured =
    validUrl &&
    validKey &&
    !url.includes("COLE_AQUI");

  window.SUPABASE_CONFIGURED = configured;

  if (!configured) {
    window.sb = null;

    console.error("Supabase não configurado corretamente.", {
      urlInformada: url || "(vazia)",
      urlValida: validUrl,

      // Não mostra a chave inteira no console
      chaveInformada: key
        ? `${key.slice(0, 12)}...`
        : "(vazia)",

      chaveValida: validKey
    });

    return;
  }

  if (!window.supabase?.createClient) {
    window.sb = null;

    console.error(
      "A biblioteca supabase-js não foi carregada."
    );

    return;
  }

  window.sb = window.supabase.createClient(
    url,
    key,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  console.log(
    "Supabase configurado com sucesso:",
    url
  );
})();
