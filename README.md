# Barbearia Prime — GitHub Pages + Supabase + Painel do Barbeiro

Esta versão registra os agendamentos no Supabase e inclui um painel administrativo
protegido por Supabase Auth e Row Level Security.

## O que já existe

### Área pública
- apresentação da barbearia;
- profissionais ativos;
- dias e horários disponíveis;
- bloqueio de horários já ocupados;
- nome + WhatsApp;
- cadastro/login de cliente;
- gravação real dos agendamentos no Supabase;
- criação automática de lembretes de 24h e 1h na tabela `notification_jobs`.

### Painel do barbeiro
- `admin-login.html`;
- login com usuário/e-mail + senha;
- `admin.html` protegido;
- agenda por data;
- nome e telefone do cliente;
- horário;
- status;
- botão para abrir WhatsApp;
- concluir, confirmar ou cancelar atendimento;
- barbeiro comum vê apenas sua própria agenda;
- conta `admin` pode visualizar todos os barbeiros.

A proteção não depende apenas do JavaScript. As políticas RLS do PostgreSQL
limitam quais linhas a conta autenticada consegue consultar ou atualizar.

---

# 1. Configure o Supabase no site

Edite `config.js`:

```js
SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
SUPABASE_PUBLISHABLE_KEY: "sb_publishable_..."
```

Nunca coloque `service_role` ou `sb_secret_...` no GitHub Pages.

---

# 2. Execute o SQL

No Supabase:

**SQL Editor → New query**

Cole TODO o conteúdo de:

```text
supabase.sql
```

e clique em **Run**.

Ele cria:

- `profiles`
- `barbers`
- `services`
- `appointments`
- `notification_jobs`
- RLS
- RPCs públicas seguras de agendamento
- triggers dos lembretes
- função de promoção de barbeiro

---

# 3. Crie a conta do barbeiro

Primeiro abra:

```text
cadastro.html
```

e crie normalmente uma conta para o barbeiro com e-mail e senha.

Se confirmação de e-mail estiver ativada no Supabase, confirme o e-mail.

Depois abra o **SQL Editor** e execute:

```sql
select public.promote_user_to_barber(
  'EMAIL_DO_BARBEIRO',
  'NOME_DO_BARBEIRO'
);
```

Exemplo:

```sql
select public.promote_user_to_barber(
  'joao@barbearia.com',
  'João'
);
```

Essa função só é usada dentro do SQL Editor. Ela foi revogada para
`anon` e `authenticated`, então o site não consegue transformar uma conta comum em barbeiro.

Depois acesse:

```text
admin-login.html
```

e entre com o e-mail e senha do barbeiro.

---

# 4. Administrador geral opcional

Se quiser que uma conta veja todos os barbeiros:

```sql
select public.promote_user_to_admin(
  'dono@barbearia.com'
);
```

Um administrador geral não precisa estar vinculado a um barbeiro para visualizar
todos os agendamentos, mas para aparecer na seleção pública como profissional,
a conta também precisa de um registro na tabela `barbers`.

---

# 5. Configure URLs do Auth

No Supabase:

**Authentication → URL Configuration**

Use como Site URL:

```text
https://SEU-USUARIO.github.io/SEU-REPOSITORIO/
```

E como Redirect URL permitida:

```text
https://SEU-USUARIO.github.io/SEU-REPOSITORIO/**
```

---

# 6. GitHub Pages

Envie os arquivos deste ZIP para a raiz do repositório.

Depois:

**Settings → Pages → Deploy from a branch → main → /(root)**

---

# Arquitetura

```text
Cliente
   ↓
GitHub Pages
   ↓
RPC segura
   ↓
Supabase
   ├── appointments
   └── notification_jobs
            ↓
      futuro polling APK
            ↓
         WhatsApp

Barbeiro
   ↓
admin-login.html
   ↓
Supabase Auth
   ↓
RLS
   ↓
somente seus agendamentos
```

---

# Próximo passo do APK

A tabela `notification_jobs` já é criada e preenchida automaticamente.

O próximo passo será atualizar o Agenda Agent APK para:
1. autenticar/parear o Galaxy S5 Mini;
2. consultar `notification_jobs` por polling;
3. reservar uma tarefa;
4. enviar no WhatsApp;
5. atualizar `sent`, `failed`, `attempts` e `last_error`.

O site público NÃO recebe permissão para ler `notification_jobs`.
