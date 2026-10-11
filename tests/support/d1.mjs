import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE devices (serial_number TEXT PRIMARY KEY, computer_name TEXT NOT NULL, windows_user TEXT, outlook_account TEXT, report_time TEXT NOT NULL, script_version TEXT NOT NULL, manufacturer TEXT, model TEXT, os_name TEXT, forticlient_user TEXT, forticlient_last_seen TEXT, c_drive_total_gb REAL, c_drive_free_gb REAL, forticlient_version TEXT);
    CREATE TABLE asset_inventory (serial_number TEXT PRIMARY KEY, device_name TEXT, asset_note TEXT, status TEXT, asset_group TEXT, sunlogin_code TEXT, sunlogin_version TEXT, deployment_source TEXT, system_version TEXT, mac_address TEXT, internal_ip TEXT, last_login_ip TEXT, last_online_time TEXT, computer_name TEXT, processor TEXT, memory TEXT, import_time TEXT);
    `);
  sqlite.exec(readFileSync('backend/migrations/0001_admin_audit.sql','utf8'));
  const DB = {
    prepare(sql) {
      const params=[];
      return {
        bind(...values) {params.push(...values);return this;},
        async first() {return sqlite.prepare(sql).get(...params)||null;},
        async all() {return {results:sqlite.prepare(sql).all(...params),success:true};},
        async run() {const result=sqlite.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes)}};}
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {const result=[];for (const statement of statements) result.push(await statement.run());sqlite.exec('COMMIT');return result;}
      catch(error) {sqlite.exec('ROLLBACK');throw error;}
    }
  };
  return {DB,sqlite};
}
