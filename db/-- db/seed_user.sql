-- db/seed_user.sql
-- Cria um usuário e (opcional) dá acesso ao primeiro curso ativo.
-- Retorna o user_id para você gerar o JWT.

begin;

-- 1) Usuário
with u as (
  insert into users(email, name)
  values ('aluno+seed@local.test','Aluno Seed')
  on conflict (email) do update set name = excluded.name
  returning id as user_id
),

-- 2) Curso ativo (pega o primeiro)
c as (
  select id as course_id
  from courses
  where active = true
  order by created_at asc
  limit 1
),

-- 3) Entitlement opcional (se houver curso)
g as (
  insert into entitlements(user_id, course_id, source)
  select u.user_id, c.course_id, 'grant'
  from u join c on true
  on conflict do nothing
  returning user_id
)

-- 4) Retorna o user_id
select user_id from u;

commit;
