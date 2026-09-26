window.BARBERSHOP_CONFIG = {
  BUSINESS_NAME: "Barbearia Prime",

  OPENING_HOURS: {
    0: { open: "09:00", close: "13:00" },
    1: null,
    2: { open: "09:00", close: "19:00" },
    3: { open: "09:00", close: "19:00" },
    4: { open: "09:00", close: "19:00" },
    5: { open: "09:00", close: "19:00" },
    6: { open: "09:00", close: "19:00" }
  },

  SLOT_INTERVAL_MINUTES: 30,
  DAYS_TO_SHOW: 10,

  /*
    SUPABASE:
    Cole aqui os dados do seu projeto.
    Use SOMENTE a Publishable Key no GitHub Pages.
  */
  SUPABASE_URL: "https://ccxuaakobqgshfrepxsw.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0MNCbLoBr1ex2xR7xYaVcg_Y6h8sQ8e",

  // Auth/perfis já usam Supabase.
  // Agendamentos serão migrados ao Supabase na próxima etapa.
  USE_SUPABASE_APPOINTMENTS: true,
  SUPABASE_TABLE: "appointments"
};
