-- db/seed_demo.sql
-- Seed mínimo para validar API: 1 curso, 1 trilha, 1 módulo (vídeo+texto+quiz), 1 usuário demo com entitlement.

begin;

-- 0) Usuário demo
with u as (
  insert into users(email, name) values ('demo@local.test','Usuário Demo')
  on conflict (email) do update set name=excluded.name
  returning id as user_id
),

-- 1) Curso e trilha
c as (
  insert into courses(slug, title, summary, level, active)
  values ('curso-intro','Curso Introdutório','Curso de exemplo para testes','beginner', true)
  returning id as course_id
),
t as (
  insert into tracks(slug, title, active)
  values ('trilha-inicial','Trilha Inicial', true)
  returning id as track_id
),
tc as (
  insert into track_courses(track_id, course_id, "order", required)
  select t.track_id, c.course_id, 1, true from t,c
  returning track_id
),

-- 2) Módulo e itens
m as (
  insert into modules(course_id, title, "order")
  select c.course_id, 'Módulo 1 — Fundamentos', 1 from c
  returning id as module_id, course_id
),
vi as (
  insert into module_items(module_id, type, "order", payload_ref)
  select m.module_id, 'video', 1, '{"mux_playback_id":"mux_playback_id_demo"}'::jsonb from m
  returning id as video_item_id, module_id
),
tx as (
  insert into module_items(module_id, type, "order", payload_ref)
  select m.module_id, 'text', 2, '{"doc_id":"doc_demo_v1","title":"Apostila - Cap. 1"}'::jsonb from m
  returning id as text_item_id, module_id
),
qz as (
  -- quiz único por módulo (conforme DDL)
  insert into quizzes(module_id, pass_score)
  select m.module_id, 70.0 from m
  returning id as quiz_id, module_id
),
qi as (
  -- cria o item 'quiz' no módulo para aparecer em /api/me/items
  insert into module_items(module_id, type, "order", payload_ref)
  select qz.module_id, 'quiz', 3, jsonb_build_object('quiz_id', qz.quiz_id) from qz
  returning id as quiz_item_id, module_id
),

-- 3) Questões
q1 as (
  insert into questions(quiz_id, kind, body, choices, answer_key)
  select qz.quiz_id,
         'single',
         '{"prompt":"O player usa qual protocolo de streaming?"}'::jsonb,
         '[{"id":"A","text":"HLS/DASH"},{"id":"B","text":"FTP"},{"id":"C","text":"RTMP no navegador"}]'::jsonb,
         '["A"]'::jsonb
  from qz
  returning id as q1_id
),
q2 as (
  insert into questions(quiz_id, kind, body, choices, answer_key)
  select qz.quiz_id,
         'multiple',
         '{"prompt":"Marque itens de segurança recomendados:"}'::jsonb,
         '[{"id":"A","text":"DRM e tokens assinados"},{"id":"B","text":"Links públicos permanentes"},{"id":"C","text":"Watermark dinâmico"}]'::jsonb,
         '["A","C"]'::jsonb
  from qz
  returning id as q2_id
),

-- 4) Produto (apenas referência; preço real será criado no Stripe)
p as (
  insert into products(type, stripe_product_id, stripe_price_id, active)
  values ('course','prod_demo','price_demo', true)
  returning id as product_id
)

-- 5) Entitlement para o usuário demo acessar o curso
insert into entitlements(user_id, course_id, source)
select u.user_id, c.course_id, 'grant' from u,c
on conflict do nothing;

commit;

-- Dicas:
-- 1) Para testar /catalog e /catalog/courses/:id/modules, pegue o course_id:
--    select id, slug, title from courses;
-- 2) Para testar /quizzes/:quizId/submit, pegue o quiz_id:
--    select id, module_id from quizzes;
-- 3) Para testar playback-token em DEV_FAKE=1 funciona sem Mux.
--    Em produção, troque "mux_playback_id_demo" pelo playback_id real do Mux.
