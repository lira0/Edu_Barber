/* =========================================================
   FREITAS BARBEARIA
   Login unificado: telefone OU e-mail + senha

   - E-mail: usa Supabase Auth diretamente.
   - Telefone: usa a Edge Function "login-identity".
   - Nunca coloca chave secreta no navegador.
   ========================================================= */

(function () {
  "use strict";

  const CUSTOMER_AUTH_DOMAIN = "barbearia.invalid";

  function digits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeNationalPhone(value) {
    let d = digits(value);

    if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
      d = d.slice(2);
    }

    if (d.length !== 10 && d.length !== 11) return null;

    return d;
  }

  function toDatabasePhone(value) {
    const national = normalizeNationalPhone(value);
    return national ? `55${national}` : null;
  }

  function customerTechnicalEmail(value) {
    const dbPhone = toDatabasePhone(value);

    if (!dbPhone) return null;

    return `cliente.${dbPhone}@${CUSTOMER_AUTH_DOMAIN}`;
  }

  function isEmailIdentity(value) {
    return String(value || "").includes("@");
  }

  function isInfrastructureFunctionError(error) {
    if (!error) return false;

    const status =
      error?.context?.status ||
      error?.status ||
      null;

    const name = String(error?.name || "");
    const message = String(error?.message || "").toLowerCase();

    return (
      Number(status) === 404 ||
      name === "FunctionsFetchError" ||
      name === "FunctionsRelayError" ||
      message.includes("failed to send") ||
      message.includes("fetch failed") ||
      message.includes("not found")
    );
  }

  async function signInWithIdentity(identity, password) {
    if (!window.sb) {
      return {
        data: null,
        error: new Error("SUPABASE_NOT_CONFIGURED")
      };
    }

    const rawIdentity = String(identity || "").trim();

    if (!rawIdentity || !password) {
      return {
        data: null,
        error: new Error("INVALID_CREDENTIALS")
      };
    }

    /* -------------------------------------------------------
       E-mail continua usando o Auth oficial diretamente.
       ------------------------------------------------------- */
    if (isEmailIdentity(rawIdentity)) {
      return await window.sb.auth.signInWithPassword({
        email: rawIdentity.toLowerCase(),
        password
      });
    }

    /* -------------------------------------------------------
       Telefone.
       ------------------------------------------------------- */
    const dbPhone = toDatabasePhone(rawIdentity);

    if (!dbPhone) {
      return {
        data: null,
        error: new Error("INVALID_PHONE")
      };
    }

    /*
      A Edge Function resolve o telefone no servidor, descobre
      o e-mail Auth correspondente e autentica sem revelar
      credenciais administrativas ao navegador.
    */
    const { data: functionData, error: functionError } =
      await window.sb.functions.invoke("login-identity", {
        body: {
          identity: dbPhone,
          password
        }
      });

    if (!functionError &&
        functionData?.access_token &&
        functionData?.refresh_token) {

      const { data, error } = await window.sb.auth.setSession({
        access_token: functionData.access_token,
        refresh_token: functionData.refresh_token
      });

      return {
        data,
        error,
        role: functionData.role || null
      };
    }

    /*
      Compatibilidade temporária:
      se a Edge Function ainda NÃO foi instalada, clientes
      antigos continuam conseguindo entrar pelo e-mail técnico.

      Não usamos esse fallback quando a função existe e devolve
      senha inválida, justamente para não contornar a nova regra.
    */
    if (isInfrastructureFunctionError(functionError)) {
      const technicalEmail = customerTechnicalEmail(dbPhone);

      if (technicalEmail) {
        return await window.sb.auth.signInWithPassword({
          email: technicalEmail,
          password
        });
      }
    }

    return {
      data: null,
      error:
        functionError ||
        new Error(
          functionData?.message ||
          "INVALID_CREDENTIALS"
        )
    };
  }

  async function getCurrentRole() {
    if (!window.sb) return null;

    const {
      data: { user }
    } = await window.sb.auth.getUser();

    if (!user) return null;

    const { data, error } = await window.sb
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Erro ao consultar role:", error);
      return null;
    }

    return data?.role || null;
  }

  window.BarberAuth = {
    signInWithIdentity,
    getCurrentRole,
    toDatabasePhone
  };
})();
