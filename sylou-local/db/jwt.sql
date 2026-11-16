-- How long a sign-in token lasts, for the database's own view of it.
--
-- Supabase's version of this script also writes the signing secret into the
-- database. Sylou's does not: the two services that need it read it from a
-- file, so the secret is in no table and in no setting.

\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
