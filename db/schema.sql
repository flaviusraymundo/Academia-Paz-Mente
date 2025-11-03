-- db/schema.sql
-- Postgres DDL inicial para LMS com Mux, Stripe e Cloudflare Pro
-- Requer extensões: pgcrypto para UUID. Ajuste nomes de schemas se preciso.

create extension if not exists pgcrypto;

-- ===== Usuários =====
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  created_at timestamptz not null default now()
);

-- ===== Catálogo =====
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('course','membership')),
  stripe_price_id text,         -- opcional: price ID
  stripe_product_id text,       -- opcional: product ID
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text,
  level text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists track_courses (
  track_id uuid not null references tracks(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  "order" int not null default 0,
  required boolean not null default true,
  primary key (track_id, course_id)
);

create table if not exists prerequisites (
  course_id uuid not null references courses(id) on delete cascade,
  required_course_id uuid not null references courses(id) on delete cascade,
  primary key (course_id, required_course_id),
  check (course_id <> required_course_id)
);

create table if not exists modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  "order" int not null default 0
);

create table if not exists module_items (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules(id) on delete cascade,
  type text not null check (type in ('video','text','quiz')),
  "order" int not null default 0,
  payload_ref jsonb not null default '{}'::jsonb -- ex.: { "mux_asset_id": "..."} | { "doc_id": "..."} | { "quiz_id": "..." }
);

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null unique references modules(id) on delete cascade,
  pass_score numeric(5,2) not null default 70.0
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  kind text not null check (kind in ('single','multiple','truefalse')),
  body jsonb not null,      -- {prompt, media?}
  choices jsonb not null,   -- [{id, text}]
  answer_key jsonb not null -- [{id}] ou boolean
);

-- ===== Vendas e acesso =====
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_id uuid not null references products(id),
  stripe_payment_intent text,
  status text not null check (status in ('pending','paid','failed','refunded','canceled')),
  amount_cents int,
  currency text default 'BRL',
  created_at timestamptz not null default now(),
  unique (stripe_payment_intent)
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stripe_subscription_id text unique,
  status text not null check (status in ('active','incomplete','past_due','canceled','paused')),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists entitlements (
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  source text not null check (source in ('purchase','membership','grant')),
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

-- ===== Progresso e uso =====
create table if not exists progress (
  user_id uuid not null references users(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  status text not null check (status in ('started','passed','failed','completed')),
  score numeric(5,2),
  time_spent_secs int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

create table if not exists video_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  item_id uuid not null references module_items(id) on delete cascade,
  started_at timestamptz not null default now(),
  duration_secs int not null default 0,
  meta jsonb
);

create table if not exists page_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  item_id uuid not null references module_items(id) on delete cascade,
  page int not null,
  dwell_ms int not null,
  at timestamptz not null default now()
);

-- ===== Certificados =====
create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  issued_at timestamptz not null default now(),
  hash text not null unique,
  pdf_url text not null,
  unique (user_id, course_id)
);

-- ===== Observabilidade e idempotência =====
create table if not exists webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe','mux')),
  provider_event_id text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  unique (provider, provider_event_id)
);

create table if not exists idempotency_keys (
  key text primary key,
  scope text not null,          -- ex.: 'webhook:stripe', 'api:checkout'
  status text not null check (status in ('processing','succeeded','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  response_hash text
);

create table if not exists event_log (
  event_id text primary key,    -- ULID/UUIDv7 como texto
  topic text not null,          -- 'purchase.created','progress.heartbeat',...
  actor_user_id uuid,
  entity_type text,
  entity_id text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null,         -- 'app','stripe','mux'
  ip inet,
  ua text,
  payload jsonb not null
);

-- ===== Índices úteis =====
create index if not exists idx_modules_course_order on modules(course_id, "order");
create index if not exists idx_items_module_order on module_items(module_id, "order");
create index if not exists idx_progress_user_updated on progress(user_id, updated_at desc);
create index if not exists idx_event_log_topic_time on event_log(topic, occurred_at desc);
create index if not exists idx_inbox_provider_time on webhook_inbox(provider, received_at desc);
