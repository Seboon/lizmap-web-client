-- Fix for audit.sql (Oslandia audit trigger):
-- replay_event and rollback_event did not quote table, schema and
-- column names, so names with capitals (e.g. "Tabo_Fence") failed with
-- 'relation ... does not exist'. Only identifiers are now quoted with
-- quote_ident(); the logic is unchanged.
-- Run once, as postgres or the owner of the audit functions:
--   psql -d MA_BASE -f audit_fix_majuscules.sql
-- Safe to run again; it does not touch the audit history.

CREATE OR REPLACE FUNCTION audit.replay_event(pevent_id bigint) RETURNS void AS $body$
DECLARE
  query text;
BEGIN
    with
    event as (
        select * from audit.logged_actions where event_id = pevent_id
    )
    -- get primary key names
    , where_pks as (
        select array_to_string(array_agg(quote_ident(uid_column) || '=' || quote_literal(row_data->uid_column)), ' AND ') as where_clause
          from audit.logged_relations r
          join event on relation_name = (quote_ident(schema_name) || '.' || quote_ident(table_name))::regclass
    )
    select into query
        case
            when action = 'I' then
                'INSERT INTO ' || quote_ident(schema_name) || '.' || quote_ident(table_name) ||
                ' ('||(select string_agg(quote_ident(key), ',') from each(row_data))||') VALUES ' ||
                '('||(select string_agg(case when value is null then 'null' else quote_literal(value) end, ',') from each(row_data))||')'
            when action = 'D' then
                'DELETE FROM ' || quote_ident(schema_name) || '.' || quote_ident(table_name) ||
                ' WHERE ' || where_clause
            when action = 'U' then
                'UPDATE ' || quote_ident(schema_name) || '.' || quote_ident(table_name) ||
                ' SET ' || (select string_agg(quote_ident(key) || '=' || case when value is null then 'null' else quote_literal(value) end, ',') from each(changed_fields)) ||
                ' WHERE ' || where_clause
        end
    from
        event, where_pks
    ;

    execute query;
END;
$body$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit.rollback_event(pevent_id bigint) RETURNS void AS $body$
DECLARE
    event record;
    pkeys record;
    last_event record;
    query text;
BEGIN
    -- Get event
    SELECT * INTO event FROM audit.logged_actions WHERE event_id = pevent_id;
    -- RAISE NOTICE 'event id = %', event.event_id;

    -- Get the WHERE clause to filter the events feature
    SELECT INTO pkeys
        array_to_string(array_agg(quote_ident(uid_column) || '=' || quote_literal(event.row_data->uid_column)), ' AND ') AS where_clause,
        hstore(array_agg(uid_column), array_agg( event.row_data->uid_column)) AS hstore_keys
    FROM audit.logged_relations r
    WHERE relation_name = (quote_ident(event.schema_name) || '.' || quote_ident(event.table_name))::regclass
    ;
    -- RAISE NOTICE 'hstore_keys = %', pkeys.hstore_keys;

    -- Check if this is the last event for the feature. If not cancel the rollback
    SELECT INTO last_event
        (pevent_id = la.event_id) AS is_last,
        la.event_id
    FROM audit.logged_actions AS la
    WHERE true
    AND la.schema_name = event.schema_name
    AND la.table_name = event.table_name
    AND la.row_data @> pkeys.hstore_keys
    ORDER BY la.action_tstamp_tx DESC
    LIMIT 1
    ;
    IF NOT last_event.is_last THEN
        RAISE EXCEPTION '[audit.rollback_event] - Cannot rollback this event (id = %) because a more recent event (id = %) exists for this feature', pevent_id, last_event.event_id;
        RETURN;
    END IF;


    -- Then apply the rollback
    SELECT INTO query
        CASE
            WHEN action = 'I' THEN
                'DELETE FROM ' || quote_ident(schema_name) || '.' || quote_ident(table_name) ||
                ' WHERE ' || pkeys.where_clause
            WHEN action = 'D' THEN
                'INSERT INTO ' || quote_ident(schema_name) || '.' || quote_ident(table_name) ||
                ' ('||(SELECT string_agg(quote_ident(key), ',') FROM each(row_data))||') VALUES ' ||
                '('||(SELECT string_agg(CASE WHEN value IS NULL THEN 'null' ELSE quote_literal(value) END, ',') FROM each(row_data))||')'
            WHEN action = 'U' THEN
                'UPDATE ' || quote_ident(schema_name) || '.' || quote_ident(table_name) ||
                ' SET ' || (
                    SELECT string_agg(
                        quote_ident(key) || '=' || CASE WHEN value IS NULL THEN 'null' ELSE quote_literal(value) END
                        , ','
                    ) FROM each(row_data) WHERE key = ANY (akeys(changed_fields)) ) ||
                ' WHERE ' || pkeys.where_clause

        END
    FROM
        audit.logged_actions
    WHERE event_id = pevent_id
    ;

    execute query;
END;
$body$
LANGUAGE plpgsql;
