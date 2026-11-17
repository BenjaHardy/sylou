-- The privileges and policies Sylou's migrations leave, in a form two
-- databases can be compared by: the package's own, and the migrations
-- replayed as CI does (supabase/tests/rls/setup.ts). A0 found the two
-- identical but for supabase_admin's own default privileges, which is why
-- the migrations run as postgres (T27; tests/package.test.ts).
\pset format unaligned
\pset tuples_only on
\pset fieldsep ' | '

\echo '## table/view privileges (public, storage.objects, storage.buckets) for the API roles'
select n.nspname || '.' || c.relname, c.relkind, a.grantee_name, string_agg(a.privilege_type, ',' order by a.privilege_type)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral (select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee_name, x.privilege_type
                    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x) a
where (n.nspname = 'public' or (n.nspname = 'storage' and c.relname in ('objects', 'buckets')))
  and c.relkind in ('r', 'v', 'm', 'p', 'f')
  and a.grantee_name in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by 1, 2, 3 order by 1, 3;

\echo '## column privileges (public) for the API roles'
select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  and (table_name, grantee, privilege_type) not in (
    select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public')
order by 1, 2, 3, 4;

\echo '## function EXECUTE (public schema) for the API roles and PUBLIC'
select p.oid::regprocedure::text, a.grantee_name, p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee_name, x.privilege_type
                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x) a
where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
  and a.grantee_name in ('anon', 'authenticated', 'service_role', 'PUBLIC')
order by 1, 2;

\echo '## sequences (public) for the API roles'
select c.relname, a.grantee_name, string_agg(a.privilege_type, ',' order by a.privilege_type)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral (select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee_name, x.privilege_type
                    from aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) x) a
where n.nspname = 'public' and c.relkind = 'S' and a.grantee_name in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by 1, 2 order by 1, 2;

\echo '## row-level security flags (public)'
select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1;

\echo '## policies (public, storage.objects, storage.buckets)'
select schemaname || '.' || tablename, policyname, cmd, permissive, array_to_string(roles, ','), coalesce(qual, '-'), coalesce(with_check, '-')
from pg_policies where schemaname = 'public' or (schemaname = 'storage' and tablename in ('objects', 'buckets'))
order by 1, 2;

\echo '## default privileges in schema public (who creates -> what the API roles get)'
select pg_get_userbyid(d.defaclrole), d.defaclobjtype, a.grantee_name, string_agg(a.privilege_type, ',' order by a.privilege_type)
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral (select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee_name, x.privilege_type
                    from aclexplode(d.defaclacl) x) a
where n.nspname = 'public' and a.grantee_name in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by 1, 2, 3 order by 1, 2, 3;

\echo '## schema usage for the API roles'
select n.nspname, a.grantee_name, string_agg(a.privilege_type, ',' order by a.privilege_type)
from pg_namespace n cross join lateral (select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee_name, x.privilege_type
                    from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x) a
where n.nspname in ('public', 'storage', 'auth') and a.grantee_name in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by 1, 2 order by 1, 2;

\echo '## owners of public objects'
select c.relkind, pg_get_userbyid(c.relowner), count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' group by 1, 2 order by 1, 2;
