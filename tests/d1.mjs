import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database() {
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0002_accounts_and_history.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0003_staff_workflows.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0004_login_usernames.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0005_automatic_case_reminders.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0006_profile_photos.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0007_record_creators.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0008_personal_tasks_and_rank.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0009_rank_creation_history.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0010_case_review_step.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0011_creator_email.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0012_sheet_imports.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/migrations/0013_record_creation_dates.sql',import.meta.url),'utf8'));
  return {
    raw:db,
    prepare(sql) {
      let values=[];
      const statement={bind(...args){values=args.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value);return statement;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const s=db.prepare(sql);const returning=/\bRETURNING\b/i.test(sql)||/^\s*SELECT/i.test(sql);if(returning)return {results:s.all(...values),meta:{changes:db.prepare('SELECT changes() AS n').get().n}};const result=s.run(...values);return {results:[],meta:{changes:Number(result.changes)}};}};
      return statement;
    },
    async batch(statements) {db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},
    close(){db.close();}
  };
}
