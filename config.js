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
  SUPABASE_URL: "COLE_AQUI_A_URL_DO_PROJETO",
  SUPABASE_PUBLISHABLE_KEY: "COLE_AQUI_A_PUBLISHABLE_KEY",

  // Auth/perfis já usam Supabase.
  // Agendamentos serão migrados ao Supabase na próxima etapa.
  USE_SUPABASE_APPOINTMENTS: true,
  SUPABASE_TABLE: "appointments"
};
