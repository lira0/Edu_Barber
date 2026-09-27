# Freitas Barbearia — Sistema de Agendamentos

Versão consolidada do site, sem patches.

## Incluído

- Página pública totalmente redesenhada para Freitas Barbearia
- Agendamento por profissional, data e horário
- Horários de funcionamento vindos do Supabase
- Status aberta / fechada
- Cadastro de cliente com nome + WhatsApp + senha
- Login de cliente por WhatsApp
- Login de barbeiro/admin por e-mail
- Menu lateral
- Meus agendamentos
- Painel do barbeiro
- Painel administrativo
- Lembretes automáticos configuráveis
- Lembrete manual
- Integração com notification_jobs / Agenda Agent
- Permissões para alterar horários de funcionamento

## Importante sobre config.js

O arquivo config.js deste pacote contém placeholders.

Se o seu repositório já está configurado, preserve o config.js atual com:
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY

O workflow "atualizar-site-preservando-config.yml" criado anteriormente faz essa preservação.

## SQL

A pasta `sql/` contém as migrações incrementais usadas até esta versão.

Se o banco já está atualizado, NÃO é necessário executar tudo novamente.

## Arquivo inicial

GitHub Pages deve publicar a raiz do projeto, onde está:
`index.html`
