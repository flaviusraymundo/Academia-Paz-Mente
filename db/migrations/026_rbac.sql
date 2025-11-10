-- RBAC básico (student | instructor | admin)

CREATE TABLE IF NOT EXISTS user_roles(
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student','instructor','admin'))
);

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles(role);

-- Seed opcional (substitua pelo UUID real do seu usuário)
-- INSERT INTO user_roles(user_id, role) VALUES ('40b6abe2-1708-426b-a03e-9e16e9460b20','admin')
-- ON CONFLICT (user_id) DO UPDATE SET role=excluded.role);
