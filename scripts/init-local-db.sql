-- Isolated local demo only. Production must provision separate secret-managed roles.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='traffic_reader') THEN
  CREATE ROLE traffic_reader LOGIN PASSWORD 'traffic_reader_demo' NOSUPERUSER NOCREATEDB NOCREATEROLE;
 END IF;
END $$;
GRANT CONNECT ON DATABASE traffic TO traffic_reader;
GRANT USAGE ON SCHEMA public TO traffic_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO traffic_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE traffic IN SCHEMA public GRANT SELECT ON TABLES TO traffic_reader;
