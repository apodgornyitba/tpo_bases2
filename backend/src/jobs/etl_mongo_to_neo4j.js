import { MongoClient } from 'mongodb';
import neo4j from 'neo4j-driver';

const MONGO_URI = process.env.MONGO_URI;
const NEO4J_URI  = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER;
const NEO4J_PASS = process.env.NEO4J_PASSWORD;

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
const session = (mode='WRITE') => driver.session({ defaultAccessMode: neo4j.session[mode] });

const client = new MongoClient(MONGO_URI);
const BATCH = 500;

const up = s => (s ?? '').toString().trim().toUpperCase();

const toISO = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0,10);
  const str = String(v).trim();
  const p = str.split('/');
  if (p.length === 3) {
    const [d,m,y] = p.map(x => parseInt(x,10));
    if (!Number.isNaN(d) && !Number.isNaN(m) && !Number.isNaN(y)) {
      return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }
  const t = new Date(str);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0,10);
};

async function buildPolizaIdMap(db) {
  const map = new Map();
  const cur = db.collection('polizas').find({}, { projection: { _id:1, nro_poliza:1 } });
  for await (const p of cur) {
    const oid = String(p._id);
    const nro = p.nro_poliza ? String(p.nro_poliza) : oid;
    map.set(oid, nro);
  }
  return map;
}

async function etlPolizas() {
  const db = client.db();
  const cur = db.collection('polizas').find({}, { batchSize: BATCH });
  let buf = [];
  for await (const p of cur) {
    buf.push(p);
    if (buf.length >= BATCH) { await flushPolizas(buf); buf = []; }
  }
  if (buf.length) await flushPolizas(buf);
}

async function flushPolizas(rows) {
  const s = session('WRITE');
  const tx = s.beginTransaction();
  try {
    for (const p of rows) {
      const clienteId = String(p.id_cliente);
      const agenteId  = String(p.id_agente);
      const polizaId  = p.nro_poliza ? String(p.nro_poliza) : String(p._id); // clave canónica
      const estadoUp  = up(p.estado);
      const fi = toISO(p.fecha_inicio);
      const ff = toISO(p.fecha_fin);

      await tx.run(`
        MERGE (c:Cliente {id:$cid})
        MERGE (a:Agente  {id:$aid})
        MERGE (p:Poliza  {id:$pid})
        ON CREATE SET p.nro_poliza = $nro, p.tipo=$tipo, p.estado=$estado,
                      p.fecha_inicio = CASE WHEN $fi IS NULL THEN NULL ELSE date($fi) END,
                      p.fecha_fin    = CASE WHEN $ff IS NULL THEN NULL ELSE date($ff) END,
                      p.monto_total  = toFloat($monto)
        ON MATCH  SET p.nro_poliza = coalesce(p.nro_poliza,$nro),
                      p.tipo=coalesce(p.tipo,$tipo), p.estado=$estado,
                      p.fecha_inicio = coalesce(p.fecha_inicio, CASE WHEN $fi IS NULL THEN NULL ELSE date($fi) END),
                      p.fecha_fin    = coalesce(p.fecha_fin,    CASE WHEN $ff IS NULL THEN NULL ELSE date($ff) END),
                      p.monto_total  = coalesce(p.monto_total, toFloat($monto))
        MERGE (c)-[:TIENE]->(p)
        MERGE (a)-[:GESTIONA]->(p)
      `, {
        cid: clienteId,
        aid: agenteId,
        pid: polizaId,
        nro: p.nro_poliza ? String(p.nro_poliza) : null,
        tipo: p.tipo ?? null,
        estado: estadoUp || null,
        fi, ff,
        monto: p.cobertura_total ?? null
      });
    }
    await tx.commit();
  } finally {
    await s.close();
  }
}

async function etlSiniestros() {
  const db = client.db();
  const idMap = await buildPolizaIdMap(db);
  const cur = db.collection('siniestros').find({}, { batchSize: BATCH });
  let buf = [];
  for await (const r of cur) {
    buf.push(r);
    if (buf.length >= BATCH) { await flushSiniestros(buf, idMap); buf = []; }
  }
  if (buf.length) await flushSiniestros(buf, idMap);
}

function resolvePolizaId(poliza_id, idMap) {
  if (poliza_id == null) return null;
  const raw = String(poliza_id);
  return idMap.get(raw) ?? raw;
}

async function flushSiniestros(rows, idMap) {
  const s = session('WRITE');
  const tx = s.beginTransaction();
  let skipped = 0;
  try {
    for (const r of rows) {
      const sid = String(r._id);
      const pid = r.nro_poliza ? String(r.nro_poliza) : resolvePolizaId(r.poliza_id, idMap);

      if (!pid || pid === 'null' || pid === 'undefined') {
        skipped++;
        console.warn(`[ETL][Siniestro] skip _id=${sid} por pid nulo (nro_poliza/poliza_id ausentes)`);
        continue;
      }

      const estadoUp = (r.estado ?? '').toString().trim().toUpperCase();
      const f = toISO(r.fecha);

      await tx.run(`
        MERGE (p:Poliza {id:$pid})
        MERGE (s:Siniestro {id:$sid})
        ON CREATE SET s.id_siniestro = $id_siniestro,
                      s.tipo  = $tipo,
                      s.estado= $estado,
                      s.fecha = CASE WHEN $fecha IS NULL THEN s.fecha ELSE date($fecha) END,
                      s.monto = toFloat($monto)
        ON MATCH  SET s.id_siniestro = coalesce(s.id_siniestro, $id_siniestro),
                      s.tipo  = coalesce(s.tipo, $tipo),
                      s.estado= $estado,
                      s.fecha = CASE WHEN s.fecha IS NULL AND $fecha IS NOT NULL THEN date($fecha) ELSE s.fecha END,
                      s.monto = coalesce(s.monto, toFloat($monto))
        MERGE (p)-[:TIENE]->(s)
      `, {
        pid,
        sid,
        id_siniestro: r.id_siniestro ?? null,
        tipo: r.tipo ?? null,
        estado: estadoUp || null,
        fecha: f,
        monto: r.monto_estimado ?? r.monto ?? null
      });
    }
    await tx.commit();
    if (skipped) console.warn(`[ETL] Siniestros saltados por falta de pid: ${skipped}`);
  } finally {
    await s.close();
  }
}



async function main() {
  await client.connect();
  console.log('[ETL] Mongo OK');
  await driver.getServerInfo();
  console.log('[ETL] Neo4j OK');

  await etlPolizas();
  console.log('[ETL] Polizas → Neo4j');

  await etlSiniestros();
  console.log('[ETL] Siniestros → Neo4j');

  await client.close();
  await driver.close();
  console.log('[ETL] Done');
}

main().catch(async e => {
  console.error(e);
  await client.close().catch(()=>{});
  await driver.close().catch(()=>{});
  process.exit(1);
});
