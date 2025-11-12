import express from 'express';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from './ensure-indexes.js';
import { session as neo4jSession, pingNeo4j, toInt } from './neo4j.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/aseguradoras';
const app = express();
app.use(express.json());

const asISO = d => {
  if (d && d.year && d.month && d.day) {
    const y = d.year.low ?? d.year;
    const m = String(d.month.low ?? d.month).padStart(2, '0');
    const day = String(d.day.low ?? d.day).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return d ?? null;
};

const asBool = v => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'si';
};

// Conexión Mongo
const client = new MongoClient(MONGO_URI);
let db;
async function init() {
  await client.connect();
  db = client.db(); // aseguradoras
  await ensureIndexes(db);
  console.log('Mongo conectado');
}
init().catch((e) => { console.error(e); process.exit(1); });

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Health Neo4j
app.get('/neo4j/health', async (req, res) => {
  try { res.json({ ok: await pingNeo4j() }); }
  catch { res.status(500).json({ ok: false }); }
});

// Clientes activos con pólizas vigentes
app.get('/clientes/activos-con-polizas', async (req, res) => {
  const now = new Date();
  const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize || '25', 10)));
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const skip = (page - 1) * pageSize;

  const base = [
    {
      $addFields: {
        activo_norm: {
          $in: [{ $toLower: { $toString: "$activo" } }, ["true","1","yes","y","t"]]
        }
      }
    },
    { $match: { activo_norm: true } },
    {
      $lookup: {
        from: "polizas",
        let: { cid: "$id_cliente" },
        pipeline: [
          { $match: { $expr: { $eq: ["$id_cliente", "$$cid"] } } },
          {
            $addFields: {
              _fi: {
                $cond: [
                  { $eq: [{ $type: "$fecha_inicio" }, "string"] },
                  {
                    $let: {
                      vars: { p: { $split: ["$fecha_inicio", "/"] } },
                      in: {
                        $dateFromParts: {
                          year: { $toInt: { $arrayElemAt: ["$$p", 2] } },
                          month: { $toInt: { $arrayElemAt: ["$$p", 1] } },
                          day: { $toInt: { $arrayElemAt: ["$$p", 0] } }
                        }
                      }
                    }
                  },
                  "$fecha_inicio"
                ]
              },
              _ff: {
                $cond: [
                  { $eq: [{ $type: "$fecha_fin" }, "string"] },
                  {
                    $let: {
                      vars: { p: { $split: ["$fecha_fin", "/"] } },
                      in: {
                        $dateFromParts: {
                          year: { $toInt: { $arrayElemAt: ["$$p", 2] } },
                          month: { $toInt: { $arrayElemAt: ["$$p", 1] } },
                          day: { $toInt: { $arrayElemAt: ["$$p", 0] } }
                        }
                      }
                    }
                  },
                  "$fecha_fin"
                ]
              },
              estado_norm: { $toUpper: "$estado" }
            }
          },
          {
            $match: {
              estado_norm: { $in: ["ACTIVA","VIGENTE"] },
              _fi: { $lte: now },
              _ff: { $gte: now }
            }
          }
        ],
        as: "polizas_vigentes"
      }
    },
    {
      $project: {
        _id: 0,
        id_cliente: 1,
        nombre: 1,
        apellido: 1,
        polizas_vigentes: {
          $map: {
            input: "$polizas_vigentes",
            as: "p",
            in: {
              _id: { $toString: "$$p._id" },
              nro_poliza: "$$p.nro_poliza",
              tipo: "$$p.tipo",
              estado: "$$p.estado_norm",
              fecha_inicio: { $dateToString: { date: "$$p._fi", format: "%Y-%m-%d" } },
              fecha_fin: { $dateToString: { date: "$$p._ff", format: "%Y-%m-%d" } }
            }
          }
        }
      }
    }
  ];

  const [items, total] = await Promise.all([
    db.collection('clientes').aggregate([...base, { $skip: skip }, { $limit: pageSize }]).toArray(),
    db.collection('clientes').aggregate([...base, { $count: "n" }]).toArray()
  ]);

  res.json({ page, pageSize, total: total[0]?.n || 0, items });
});

// Siniestros abiertos
app.get('/siniestros/abiertos', async (req, res) => {
  const limitNum = Math.max(1, Math.min(200, Number.parseInt(req.query.limit || '100', 10)));
  const estado = (req.query.estado || 'ABIERTO').toUpperCase(); 
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;

  const s = neo4jSession();
  try {
    const q = `
      MATCH (c:Cliente)-[:TIENE]->(p:Poliza)-[:TIENE]->(s:Siniestro)
      WHERE toUpper(s.estado) = $estado
        AND ($desde IS NULL OR s.fecha >= date($desde))
        AND ($hasta IS NULL OR s.fecha <= date($hasta))
      RETURN
        c.id    AS cliente_id,
        p.id    AS poliza_id,
        s.id    AS siniestro_id,
        s.tipo  AS tipo,
        s.monto AS monto,
        s.fecha AS fecha
      ORDER BY (s.fecha IS NULL) ASC, s.fecha DESC, s.id
      LIMIT $limit
    `;
    const r = await s.run(q, { estado, desde, hasta, limit: toInt(limitNum) });
    res.json(r.records.map(rec => {
      const obj = rec.toObject();
      obj.fecha = asISO(obj.fecha);
      return obj;
    }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'neo4j_query_failed' });
  } finally {
    await s.close();
  }
});

app.post('/clientes', async (req, res) => {
  const { id_cliente, nombre, apellido, dni, email, telefono, direccion, ciudad, provincia, activo } = req.body || {};
  if (id_cliente == null || !nombre || !apellido) {
    return res.status(400).json({ error: 'id_cliente, nombre y apellido son obligatorios' });
  }

  const idc = Number.isNaN(Number(id_cliente)) ? String(id_cliente) : Number(id_cliente);
  const exists = await db.collection('clientes').findOne({ id_cliente: idc });
  if (exists) return res.status(409).json({ error: 'cliente_ya_existe' });

  const doc = {
    id_cliente: idc,
    nombre,
    apellido,
    dni: dni ?? null,
    email: email ?? null,
    telefono: telefono ?? null,
    direccion: direccion ?? null,
    ciudad: ciudad ?? null,
    provincia: provincia ?? null,
    activo: activo == null ? true : asBool(activo)
  };

  const r = await db.collection('clientes').insertOne(doc);

  try {
    const s = neo4jSession();
    await s.run(`MERGE (c:Cliente {id:$id}) SET c.nombre=$nom, c.apellido=$ape`, {
      id: String(idc),
      nom: nombre,
      ape: apellido
    });
    await s.close();
  } catch (_) {}

  res.status(201).json({ _id: r.insertedId, ...doc });
});

app.patch('/clientes/:id/baja', async (req, res) => {
  const raw = req.params.id;
  const idc = Number.isNaN(Number(raw)) ? String(raw) : Number(raw);

  const r = await db.collection('clientes').updateOne(
    { id_cliente: idc },
    { $set: { activo: false } }
  );
  if (r.matchedCount === 0) return res.status(404).json({ error: 'cliente_no_encontrado' });

  try {
    const s = neo4jSession();
    await s.run(`MERGE (c:Cliente {id:$id}) SET c.baja = true`, { id: String(idc) });
    await s.close();
  } catch (_) {}

  res.json({ ok: true });
});

// Modificación parcial de cliente
app.patch('/clientes/:id', async (req, res) => {
  const raw = req.params.id;
  const idc = Number.isNaN(Number(raw)) ? String(raw) : Number(raw);

  const { nombre, apellido, dni, email, telefono, direccion, ciudad, provincia, activo } = req.body || {};
  const update = {};
  if (nombre != null)    update.nombre    = String(nombre);
  if (apellido != null)  update.apellido  = String(apellido);
  if (dni !== undefined) update.dni       = dni ?? null;
  if (email !== undefined) update.email   = email ?? null;
  if (telefono !== undefined) update.telefono = telefono ?? null;
  if (direccion !== undefined) update.direccion = direccion ?? null;
  if (ciudad !== undefined) update.ciudad = ciudad ?? null;
  if (provincia !== undefined) update.provincia = provincia ?? null;
  if (activo !== undefined) update.activo = asBool(activo);

  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'sin_cambios' });
  if ('id_cliente' in req.body)         return res.status(400).json({ error: 'id_no_editable' });

  const r = await db.collection('clientes').findOneAndUpdate(
    { id_cliente: idc },
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } }
  );

  if (!r.value) return res.status(404).json({ error: 'cliente_no_encontrado' });

  try {
    const s = neo4jSession();
    await s.run(
      `MERGE (c:Cliente {id:$id})
       SET c.nombre = coalesce($nombre, c.nombre),
           c.apellido = coalesce($apellido, c.apellido)`,
      { id: String(idc), nombre, apellido }
    );
    await s.close();
  } catch (_) {}

  res.json(r.value);
});


const port = process.env.PORT;
app.listen(port, () => console.log(`API :${port}`));
