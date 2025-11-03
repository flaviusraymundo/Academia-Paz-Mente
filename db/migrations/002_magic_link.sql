-- db/migrations/002_magic_link.sql
-- Tabela para magic links + índices

create extension if not exists pgcrypto;

create table if not exists magic_link_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references users(id) on delete set null,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  ip inet,
  ua text
);

create index if not exists idx_magic_link_email_time on magic_link_tokens(email, created_at desc);
create index if not exists idx_magic_link_expires on magic_link_tokens(expires_at);
