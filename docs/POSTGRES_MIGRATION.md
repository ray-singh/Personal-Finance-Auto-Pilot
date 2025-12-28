# PostgreSQL Migration Guide

This guide covers migrating from SQLite to PostgreSQL with Row-Level Security (RLS) for production multi-tenancy.

## Overview

- **SQLite**: Local development (default)
- **PostgreSQL**: Production with RLS for complete data isolation
- **Switch**: Set `DATABASE_TYPE=postgres` in `.env.local`

## Prerequisites

### 1. Install PostgreSQL

**macOS (Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Docker:**
```bash
docker run --name finance-postgres \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=finance \
  -p 5432:5432 \
  -d postgres:16-alpine
```

### 2. Create Database

```bash
# Connect to postgres
psql -U postgres

# Create database
CREATE DATABASE finance;

# Create user (optional)
CREATE USER finance_app WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE finance TO finance_app;

# Exit
\q
```

## Migration Steps

### Step 1: Install Dependencies

```bash
npm install
```

New dependencies added:
- `pg` - PostgreSQL client
- `@types/pg` - TypeScript types
- `dotenv` - Environment variable management
- `ts-node` - Script execution

### Step 2: Configure Environment

Copy `.env.example` to `.env.local` and update:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Keep DATABASE_TYPE=sqlite for now
DATABASE_TYPE=sqlite

# Add Postgres credentials
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=finance
POSTGRES_USER=postgres
POSTGRES_PASSWORD=yourpassword
POSTGRES_SSL=false

# For first-time setup
AUTO_INIT_DB=true
```

### Step 3: Initialize Postgres Schema

```bash
npm run db:init
```

This creates:
- ✅ Tables with proper schema
- ✅ Row-Level Security policies
- ✅ Performance indexes
- ✅ Default category rules

### Step 4: Migrate Existing Data (Optional)

If you have SQLite data to migrate:

```bash
npm run db:migrate
```

This script:
- Exports all transactions from SQLite
- Exports all category rules
- Imports into Postgres
- Verifies data integrity
- Provides summary report

### Step 5: Switch to Postgres

Update `.env.local`:

```env
DATABASE_TYPE=postgres
```

### Step 6: Test Application

```bash
npm run dev
```

Verify:
- ✅ Authentication works
- ✅ Transactions load
- ✅ CSV upload works
- ✅ AI queries work
- ✅ Users only see their own data

## Row-Level Security (RLS)

### What is RLS?

RLS enforces data isolation at the database level, ensuring users can only access their own data even if application code has bugs.

### RLS Policy

```sql
CREATE POLICY transactions_user_isolation ON transactions
FOR ALL
USING (user_id = current_setting('app.current_user_id', true))
WITH CHECK (user_id = current_setting('app.current_user_id', true));
```

**How it works:**
1. Application sets `app.current_user_id` session variable
2. Every query automatically filters by `user_id`
3. Users cannot see or modify other users' data
4. Protection even against SQL injection

### Verify RLS

```sql
-- Connect as postgres
psql -U postgres finance

-- Test RLS
SET app.current_user_id = 'user_123';
SELECT * FROM transactions;  -- Only sees user_123's data

SET app.current_user_id = 'user_456';
SELECT * FROM transactions;  -- Only sees user_456's data
```

## AWS RDS Setup (Production)

### 1. Create RDS Instance

```bash
# Via AWS CLI
aws rds create-db-instance \
  --db-instance-identifier finance-production \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16.1 \
  --master-username finance_admin \
  --master-user-password 'YourStrongPassword' \
  --allocated-storage 20 \
  --storage-encrypted \
  --backup-retention-period 7 \
  --publicly-accessible false \
  --vpc-security-group-ids sg-xxxxxxxxx
```

### 2. Configure Security Group

Allow connections from your app:
- Inbound rule: PostgreSQL (5432) from app security group

### 3. Update Environment Variables

```env
POSTGRES_HOST=finance-production.xxxx.us-east-1.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_DB=finance
POSTGRES_USER=finance_admin
POSTGRES_PASSWORD=YourStrongPassword
POSTGRES_SSL=true
```

### 4. Initialize RDS Database

```bash
npm run db:init
```

### 5. Migrate Data

```bash
npm run db:migrate
```

## Performance Optimization

### Indexes

All critical indexes are automatically created:
- `idx_transactions_user_id` - Fast user filtering
- `idx_transactions_date` - Date range queries
- `idx_transactions_category` - Category aggregations
- `idx_transactions_user_date` - Composite for user+date queries

### Connection Pooling

PostgreSQL module uses connection pooling:
- Max 20 connections
- 30s idle timeout
- 2s connection timeout

### Query Performance

Monitor slow queries:

```sql
-- Enable slow query log
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- 1 second
SELECT pg_reload_conf();

-- View slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

## Backup & Recovery

### Automated Backups (RDS)

```bash
# Enable automated backups (7 days)
aws rds modify-db-instance \
  --db-instance-identifier finance-production \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00"
```

### Manual Backup

```bash
# Create snapshot
aws rds create-db-snapshot \
  --db-instance-identifier finance-production \
  --db-snapshot-identifier finance-backup-$(date +%Y%m%d)
```

### Local Backup

```bash
# Export to SQL
pg_dump -U postgres finance > backup.sql

# Restore from SQL
psql -U postgres finance < backup.sql
```

## Rollback Plan

If migration fails:

1. **Keep SQLite**: Set `DATABASE_TYPE=sqlite` in `.env.local`
2. **SQLite data is preserved**: Original database unchanged
3. **Gradual migration**: Test Postgres in parallel before switching

## Troubleshooting

### Connection refused

```bash
# Check if Postgres is running
pg_isready -U postgres

# Check listening port
sudo lsof -i :5432
```

### Permission denied

```sql
-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO finance_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO finance_app;
```

### RLS blocking queries

```sql
-- Temporarily disable RLS for debugging
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- Re-enable after debugging
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
```

### Migration data mismatch

```bash
# Verify counts
npm run db:migrate

# Check in Postgres
psql -U postgres finance
SELECT COUNT(*) FROM transactions;
SELECT COUNT(*) FROM category_rules;
```

## Security Best Practices

1. ✅ **Use RLS**: Enforces data isolation at DB level
2. ✅ **SSL/TLS**: Enable for RDS connections (`POSTGRES_SSL=true`)
3. ✅ **Secrets management**: Use AWS Secrets Manager in production
4. ✅ **Least privilege**: App user only needs SELECT/INSERT/UPDATE/DELETE
5. ✅ **Audit logging**: Enable RDS audit logs
6. ✅ **Backups**: 7-day retention minimum
7. ✅ **Encryption at rest**: Enable on RDS

## Cost Estimates (AWS RDS)

- **db.t4g.micro**: ~$15/month (1 vCPU, 1GB RAM)
- **db.t4g.small**: ~$30/month (2 vCPU, 2GB RAM)
- **Storage**: $0.115/GB-month
- **Backup storage**: Free up to DB size, then $0.095/GB-month

## Next Steps

After migration:
1. ✅ Update README with Postgres setup
2. ✅ Add RLS to resume bullets
3. ✅ Monitor query performance
4. ✅ Set up automated backups
5. ✅ Test multi-user scenarios
6. ✅ Add observability (CloudWatch logs)

## Support

- PostgreSQL docs: https://www.postgresql.org/docs/
- AWS RDS docs: https://docs.aws.amazon.com/rds/
- `pg` node module: https://node-postgres.com/
