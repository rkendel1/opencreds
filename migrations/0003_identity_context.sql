-- Identity context columns for multi-tenant support.
-- All columns are nullable to preserve backward compatibility with existing
-- single-user deployments.

-- Recreate connections table with identity columns.
-- SQLite requires table recreation to add new columns with defaults
-- and to properly handle the unique constraint across identity columns.

-- Create new connections table with identity columns
create table connections_new (
  service text not null,
  connection_name text not null,
  tenant_id text not null default '',
  user_id text not null default '',
  workspace_id text,
  value text not null,
  updated_at text not null,
  -- Primary key now includes identity columns
  primary key (service, connection_name, tenant_id, user_id)
);

-- Copy existing data (empty string for identity columns)
insert into connections_new (service, connection_name, tenant_id, user_id, workspace_id, value, updated_at)
select service, connection_name, '', '', null, value, updated_at from connections;

-- Drop old table and rename new one
drop table connections;
alter table connections_new rename to connections;

-- Add identity columns to runtime_tokens table
alter table runtime_tokens add column tenant_id text;
alter table runtime_tokens add column user_id text;

-- Add identity columns to runs table
alter table runs add column tenant_id text;
alter table runs add column user_id text;
alter table runs add column workspace_id text;

-- Create indexes for efficient identity-scoped queries
create index if not exists connections_tenant_id_idx on connections (tenant_id);
create index if not exists connections_user_id_idx on connections (user_id);
create index if not exists runtime_tokens_tenant_id_idx on runtime_tokens (tenant_id);
create index if not exists runtime_tokens_user_id_idx on runtime_tokens (user_id);
create index if not exists runs_tenant_id_idx on runs (tenant_id);
create index if not exists runs_user_id_idx on runs (user_id);
