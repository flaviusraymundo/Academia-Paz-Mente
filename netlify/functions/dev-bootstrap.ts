// netlify/functions/dev-bootstrap.ts
import { pool } from "../../src/server/lib/db.ts";

const SCHEMA_SQL = `
create extension if not exists pgcrypto;
create table if not exists users (id uuid primary key default gen_random_uuid(),email text not null unique,name text,created_at timestamptz not null default now());
create table if not exists products (id uuid primary key default gen_random_uuid(),type text not null check (type in ('course','membership')),stripe_price_id text,stripe_product_id text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists courses (id uuid primary key default gen_random_uuid(),slug text not null unique,title text not null,summary text,level text,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists tracks (id uuid primary key default gen_random_uuid(),slug text not null unique,title text not null,active boolean not null default true,created_at timestamptz not null default now());
create table if not exists track_courses (track_id uuid not null references tracks(id) on delete cascade,course_id uuid not null references courses(id) on delete cascade,"order" int not null default 0,required boolean not null default true,primary key (track_id, course_id));
create table if not exists prerequisites (course_id uuid not null references courses(id) on delete cascade,required_course_id uuid not null references courses(id) on delete cascade,primary key (course_id, required_course_id),check (course_id <> required_course_id));
create table if not exists modules (id uuid primary key default gen_random_uuid(),course_id uuid not null references courses(id) on delete cascade,title text not null,"order" int not null default 0);
create table if not exists module_items (id uuid primary key default gen_random_uuid(),module_id uuid not null references modules(id) on delete cascade,type text not null check (type in ('video','text','quiz')),"order" int not null default 0,payload_ref jsonb not null default '{}'::jsonb);
create table if not exists quizzes (id uuid primary key default gen_random_uuid(),module_id uuid not null unique references modules(id) on delete cascade,pass_score numeric(5,2) not null default 70.0);
create table if not exists questions (id uuid primary key default gen_random_uuid(),quiz_id uuid not null references quizzes(id) on delete cascade,kind text not null check (kind in ('single','multiple','truefalse')),body jsonb not null,choices jsonb not null,answer_key jsonb not null);
create table if not exists purchases (id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id) on delete cascade,product_id uuid not null references products(id),stripe_payment_intent text,status text not null check (status in ('pending','paid','failed','refunded','canceled')),amount_cents int,currency text default 'BRL',created_at timestamptz not null default now(),unique (stripe_payment_intent));
create table if not exists memberships (id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id) on delete cascade,stripe_subscription_id text unique,status text not null check (status in ('active','incomplete','past_due','canceled','paused')),current_period_end timestamptz,created_at timestamptz not null default now());
create table if not exists entitlements (user_id uuid not null references users(id) on delete cascade,course_id uuid not null references courses(id) on delete cascade,source text not null check (source in ('purchase','membership','grant')),created_at timestamptz not null default now(),primary key (user_id, course_id));
create table if not exists progress (user_id uuid not null references users(id) on delete cascade,module_id uuid not null references modules(id) on delete cascade,status text not null check (status in ('started','passed','failed','completed')),score numeric(5,2),time_spent_secs int not null default 0,updated_at timestamptz not null default now(),primary key (user_id, module_id));
create table if not exists video_sessions (id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id) on delete cascade,item_id uuid not null references module_items(id) on delete cascade,started_at timestamptz not null default now(),duration_secs int not null default 0,meta jsonb);
create table if not exists page_reads (id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id) on delete cascade,item_id uuid not null references module_items(id) on delete cascade,page int not null,dwell_ms int not null,at timestamptz not null default now());
create table if not exists certificates (id uuid primary key default gen_random_uuid(),user_id uuid not null references users(id) on delete cascade,course_id uuid not null references courses(id) on delete cascade,issued_at timestamptz not null default now(),hash text not null unique,pdf_url text not null,unique (user_id, course_id));
create table if not exists webhook_inbox (id uuid primary key default gen_random_uuid(),provider text not null check (provider in ('stripe','mux')),provider_event_id text not null,received_at timestamptz not null default now(),payload jsonb not null,unique (provider, provider_event_id));
create table if not exists idempotency_keys (key text primary key,scope text not null,status text not null check (status in ('processing','succeeded','failed')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),response_hash text);
create table if not exists event_log (event_id text primary key,topic text not null,actor_user_id uuid,entity_type text,entity_id text,occurred_at timestamptz not null,received_at timestamptz not null default now(),source text not null,ip inet,ua text,payload jsonb not null);
create index if not exists idx_modules_course_order on modules(course_id, "order");
create index if not exists idx_items_module_order on module_items(module_id, "order");
create index if not exists idx_progress_user_updated on progress(user_id, updated_at desc);
create index if not exists idx_event_log_topic_time on event_log(topic, occurred_at desc);
create index if not exists idx_inbox_provider_time on webhook_inbox(provider, received_at desc);
`;

const SEED_SQL = `
with u as (
  insert into users(email, name) values ('demo@local.test','Usuário Demo')
  on conflict (email) do update set name=excluded.name
  returning id as user_id
),
c as (
  insert into courses(slug, title, summary, level, active)
  values ('curso-intro','Curso Introdutório','Curso de exemplo para testes','beginner', true)
  on conflict (slug) do update set title=excluded.title
  returning id as course_id
),
t as (
  insert into tracks(slug, title, active)
  values ('trilha-inicial','Trilha Inicial', true)
  on conflict (slug) do update set title=excluded.title
  returning id as track_id
),
tc as (
  insert into track_courses(track_id, course_id, "order", required)
  select t.track_id, c.course_id, 1, true from t,c
  on conflict (track_id, course_id) do nothing
  returning track_id
),
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
  insert into quizzes(module_id, pass_score)
  select m.module_id, 70.0 from m
  returning id as quiz_id, module_id
),
qi as (
  -- cria o item 'quiz' para que o app exiba o botão "Abrir quiz"
  insert into module_items(module_id, type, "order", payload_ref)
  select qz.module_id, 'quiz', 3, jsonb_build_object('quiz_id', qz.quiz_id) from qz
  returning id as quiz_item_id, module_id
),
q1 as (
  insert into questions(quiz_id, kind, body, choices, answer_key)
  select qz.quiz_id,'single','{"prompt":"O player usa qual protocolo de streaming?"}'::jsonb,
         '[{"id":"A","text":"HLS/DASH"},{"id":"B","text":"FTP"},{"id":"C","text":"RTMP no navegador"}]'::jsonb,'["A"]'::jsonb
  from qz returning id
),
q2 as (
  insert into questions(quiz_id, kind, body, choices, answer_key)
  select qz.quiz_id,'multiple','{"prompt":"Marque itens de segurança recomendados:"}'::jsonb,
         '[{"id":"A","text":"DRM e tokens assinados"},{"id":"B","text":"Links públicos permanentes"},{"id":"C","text":"Watermark dinâmico"}]'::jsonb,'["A","C"]'::jsonb
  from qz returning id
),
p as (
  insert into products(type, stripe_product_id, stripe_price_id, active)
  values ('course','prod_demo','price_demo', true)
  on conflict do nothing returning id
)
insert into entitlements(user_id, course_id, source)
select u.user_id, c.course_id, 'grant' from u,c
on conflict do nothing;
`;

export const handler = async () => {
  if (process.env.DEV_FAKE !== "1") {
    return { statusCode: 403, body: "forbidden" };
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(SCHEMA_SQL);
    await client.query("commit");
  } catch (e: any) {
    await client.query("rollback");
    return { statusCode: 500, body: "schema_error" };
  } finally {
    client.release();
  }

  const c2 = await pool.connect();
  try {
    await c2.query("begin");
    await c2.query(SEED_SQL);
    await c2.query("commit");
    return { statusCode: 200, body: "ok" };
  } catch (e: any) {
    await c2.query("rollback");
    return { statusCode: 500, body: "seed_error" };
  } finally {
    c2.release();
  }
};
