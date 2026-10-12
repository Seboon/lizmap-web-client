<?php

/**
 * Checks, before the installer changes the Lizmap tables of a PostgreSQL
 * database, that the database user of Lizmap may alter them.
 *
 * PostgreSQL only lets the owner of a table (or a member of the owner role,
 * or a superuser) run ALTER TABLE on it. When the tables were created by
 * another role (a database reused from another installation, tables
 * restored by postgres...), the installer stops in the middle with
 * "must be owner of table jlx_user" and leaves the installation half done.
 * These checks run in preInstall(), before any change, and give the SQL
 * that solves the problem.
 *
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
class LizmapDbOwnership
{
    /**
     * Tables of the given names, in the schemas of the search path of the
     * connection, that the current user cannot alter.
     *
     * @param jDbConnection $cnx    Connection (PostgreSQL)
     * @param string[]      $tables Names of the tables
     *
     * @return array list of array('table' => schema.table, 'owner' => role)
     */
    public static function notAlterable($cnx, $tables)
    {
        if ($cnx->dbms != 'pgsql' || !count($tables)) {
            return array();
        }
        $names = implode(',', array_map(array($cnx, 'quote'), $tables));
        $sql = 'SELECT n.nspname AS schema_name, c.relname AS table_name,'
            .' pg_get_userbyid(c.relowner) AS owner'
            .' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace'
            ." WHERE c.relkind IN ('r', 'p') AND c.relname IN (".$names.')'
            .' AND n.nspname = ANY (current_schemas(false))'
            .' AND NOT pg_has_role(current_user, c.relowner, \'MEMBER\')'
            .' AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)';
        $result = array();
        foreach ($cnx->query($sql) as $row) {
            $result[] = array(
                'table' => $row->schema_name.'.'.$row->table_name,
                'owner' => $row->owner,
            );
        }

        return $result;
    }

    /**
     * Name of the current database user.
     *
     * @param jDbConnection $cnx Connection
     *
     * @return string
     */
    public static function currentUser($cnx)
    {
        $rs = $cnx->query('SELECT current_user AS u');
        $row = $rs->fetch();

        return $row ? $row->u : '';
    }

    /**
     * SQL giving the tables to the database user of Lizmap, to be run by
     * their owner or by postgres.
     *
     * @param array  $problems Result of notAlterable()
     * @param string $user     Database user of Lizmap
     *
     * @return string
     */
    public static function fixSql($problems, $user)
    {
        $lines = array();
        foreach ($problems as $problem) {
            $lines[] = 'ALTER TABLE '.$problem['table'].' OWNER TO "'.$user.'";';
        }

        return implode("\n", $lines);
    }
}
