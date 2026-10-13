# Meu Financeiro — PWA pessoal

Primeira versão de um controle financeiro para Safari/iPhone. Interface em português, saldo inicial, lançamentos pagos e previstos, cadastro de dívidas, parcelas previstas, recorrências, projeção de 30 dias e exportação/importação de backup JSON.

## Importante sobre sincronização
O app funciona localmente sem conta. A sincronização na nuvem é opcional e precisa de um projeto Supabase configurado. Não insira uma chave `service_role` ou segredo no navegador. Use somente a chave pública/anon e habilite Row Level Security (RLS) conforme abaixo.

## Publicar gratuitamente com GitHub Pages
1. Crie/entre em https://github.com.
2. Crie um repositório público chamado `meu-financeiro` (para GitHub Pages gratuito).
3. Envie todos os arquivos desta pasta para a raiz do repositório.
4. No repositório, abra **Settings → Pages**.
5. Em **Build and deployment**, escolha **Deploy from a branch**, selecione `main` e `/ (root)`, e salve.
6. Aguarde a URL publicada, geralmente `https://SEU-USUARIO.github.io/meu-financeiro/`.
7. No iPhone, abra a URL no Safari → botão Compartilhar → **Adicionar à Tela de Início**.

Não use `file://` para abrir o HTML: PWA/service worker precisa de HTTPS ou localhost.

## Ativar backup e sincronização automática
1. Crie um projeto em https://supabase.com.
2. Em **Project Settings → API**, copie a Project URL e a chave pública `anon`/publishable.
3. No painel SQL do Supabase, execute:

```sql
create table public.finance_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.finance_backups enable row level security;

create policy "Users can read their own finance backup"
on public.finance_backups for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own finance backup"
on public.finance_backups for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own finance backup"
on public.finance_backups for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

4. Abra o app → **Ajustes → Sincronização na nuvem**.
5. Cole Project URL e chave pública, informe seu e-mail e uma senha forte e toque em **Criar conta**.
6. Se o Supabase pedir confirmação de e-mail, confirme pelo e-mail recebido.
7. Volte ao app, informe as credenciais e toque em **Entrar e sincronizar**.

O backup automático começa após o login, sempre que houver mudanças, com um pequeno atraso. O app tenta restaurar um backup existente. Ao entrar pela primeira vez em outro aparelho sem dados locais, ele pode importar o backup existente.

### Cuidados
- Guarde sua senha e mantenha o acesso ao e-mail de recuperação.
- Exporte um backup JSON ocasionalmente em Ajustes.
- Não apague os dados do Safari antes de verificar que a nuvem foi sincronizada.
- Se usar o app em dois dispositivos ao mesmo tempo, a primeira versão não faz mesclagem inteligente de alterações simultâneas. Evite editar nos dois aparelhos ao mesmo tempo.
- As credenciais de nuvem ficam guardadas no navegador desse aparelho; não compartilhe o aparelho desbloqueado.
- Esta é uma versão inicial: teste com valores fictícios antes de confiar nela para todos os seus registros.

## Modelo financeiro da versão inicial
- Saldo atual = saldo inicial + entradas confirmadas − gastos/pagamentos confirmados.
- Previsões não afetam o saldo atual.
- Saldo projetado = saldo atual + previsões dentro dos próximos 30 dias.
- Dívida cadastrada é separada dos pagamentos para evitar descontar o total da dívida de uma vez.
- Ao cadastrar uma dívida com parcelas, o app cria previsões de parcelas iguais; confirme valores/datas na lista de lançamentos.

## Arquivos
- `index.html`: interface e formulário
- `app.js`: regras, armazenamento e sincronização Supabase
- `manifest.json`: metadados de instalação PWA
- `service-worker.js`: cache offline básico
- `icon.svg`: ícone
