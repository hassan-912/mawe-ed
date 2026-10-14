import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database() {
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
  return {
    raw:db,
    prepare(sql) {
      let values=[];
      const statement={bind(...args){values=args;return statement;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const s=db.prepare(sql);const returning=/\bRETURNING\b/i.test(sql)||/^\s*SELECT/i.test(sql);if(returning)return {results:s.all(...values),meta:{changes:db.prepare('SELECT changes() AS n').get().n}};const result=s.run(...values);return {results:[],meta:{changes:Number(result.changes)}};}};
      return statement;
    },
    async batch(statements) {db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},
    close(){db.close();}
  };
}
