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

function formatDateToISO(value) {
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (!value) return toISO(today);
    if (value instanceof Date) return toISO(value);
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
        const [d, m, y] = s.split('/');
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
        const [y, m, d] = s.split('/');
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return toISO(parsed);
    return toISO(today);
}

// Helper: bool flexible (accepts 'si', 'sí', yes, y, t, 1, true)
const asBoolFlex = v => {
    if (typeof v === 'boolean') return v;
    const s = String(v ?? '').trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 't', 'si', 'sí'].includes(s);
};

// Helper: date dd/m/yyyy | yyyy-mm-dd -> ISO yyyy-mm-dd or null
const toISO = (v) => {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const p = s.split('/');
    if (p.length === 3) {
        const [d, m, y] = p.map(x => parseInt(x, 10));
        if (!Number.isNaN(d) && !Number.isNaN(m) && !Number.isNaN(y)) {
            return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }
    return null;
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
                    $in: [{ $toLower: { $toString: "$activo" } }, ["true", "1", "yes", "y", "t"]]
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
                            estado_norm: { $in: ["ACTIVA", "VIGENTE"] },
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
    } catch (_) { }

    res.status(201).json({ _id: r.insertedId, ...doc });
});

app.post('/polizas', async (req, res) => {
    const {
        nro_poliza, id_cliente, id_agente,
        tipo, fecha_inicio, fecha_fin,
        prima_mensual, cobertura_total, estado
    } = req.body || {};

    if (!nro_poliza || id_cliente == null || id_agente == null || !tipo) {
        return res.status(400).json({ error: 'nro_poliza, id_cliente, id_agente y tipo son obligatorios' });
    }

    const dup = await db.collection('polizas').findOne({ nro_poliza: String(nro_poliza) });
    if (dup) return res.status(409).json({ error: 'poliza_duplicada' });

    const cid = Number.isNaN(Number(id_cliente)) ? String(id_cliente) : Number(id_cliente);
    const aid = Number.isNaN(Number(id_agente)) ? String(id_agente) : Number(id_agente);

    const c = await db.collection('clientes').findOne({ id_cliente: cid });
    const a = await db.collection('agentes').findOne({ id_agente: aid });

    if (!c) return res.status(400).json({ error: 'cliente_inexistente' });
    if (!a) return res.status(400).json({ error: 'agente_inexistente' });

    const clienteActivo = asBoolFlex(c.activo ?? true);
    const agenteActivo = asBoolFlex(a.activo ?? true);
    if (!clienteActivo) return res.status(400).json({ error: 'cliente_inactivo' });
    if (!agenteActivo) return res.status(400).json({ error: 'agente_inactivo' });

    const fiISO = toISO(fecha_inicio);
    const ffISO = toISO(fecha_fin);
    if (!fiISO || !ffISO) return res.status(400).json({ error: 'fechas_invalidas' });
    if (fiISO > ffISO) return res.status(400).json({ error: 'rango_fechas_invalido' });

    const estadoUp = (estado ?? 'ACTIVA').toString().trim().toUpperCase();

    const doc = {
        nro_poliza: String(nro_poliza),
        id_cliente: cid,
        id_agente: aid,
        tipo: String(tipo),
        fecha_inicio: fiISO,
        fecha_fin: ffISO,
        prima_mensual: prima_mensual != null ? Number(prima_mensual) : null,
        cobertura_total: cobertura_total != null ? Number(cobertura_total) : null,
        estado: estadoUp
    };

    await db.collection('polizas').insertOne(doc);

    const s = neo4jSession();
    try {
        await s.run(
            `
        MERGE (c:Cliente {id:$cid})
        MERGE (a:Agente  {id:$aid})
        MERGE (p:Poliza  {id:$pid})
        ON CREATE SET p.nro_poliza=$pid, p.tipo=$tipo,
                      p.estado=$estado,
                      p.fecha_inicio=date($fi),
                      p.fecha_fin=date($ff),
                      p.monto_total = CASE WHEN $cob IS NULL THEN NULL ELSE toFloat($cob) END
        ON MATCH  SET p.tipo=$tipo,
                      p.estado=$estado,
                      p.fecha_inicio=date($fi),
                      p.fecha_fin=date($ff),
                      p.monto_total = CASE WHEN $cob IS NULL THEN p.monto_total ELSE toFloat($cob) END
        MERGE (c)-[:TIENE]->(p)
        MERGE (a)-[:GESTIONA]->(p)
        `,
            {
                cid: String(cid),
                aid: String(aid),
                pid: String(nro_poliza),
                tipo: doc.tipo,
                estado: estadoUp,
                fi: fiISO,
                ff: ffISO,
                cob: doc.cobertura_total
            }
        );
    } catch (e) {
        await db.collection('polizas').updateOne({ nro_poliza: String(nro_poliza) }, { $set: { _neo4j_sync_error: true, _neo4j_error: String(e) } });
    } finally {
        await s.close();
    }

    res.status(201).json(doc);
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
    } catch (_) { }

    res.json({ ok: true });
});

// Modificación parcial de cliente
app.patch('/clientes/:id', async (req, res) => {
    const raw = req.params.id;
    const idc = Number.isNaN(Number(raw)) ? String(raw) : Number(raw);

    const { nombre, apellido, dni, email, telefono, direccion, ciudad, provincia, activo } = req.body || {};
    const update = {};
    if (nombre != null) update.nombre = String(nombre);
    if (apellido != null) update.apellido = String(apellido);
    if (dni !== undefined) update.dni = dni ?? null;
    if (email !== undefined) update.email = email ?? null;
    if (telefono !== undefined) update.telefono = telefono ?? null;
    if (direccion !== undefined) update.direccion = direccion ?? null;
    if (ciudad !== undefined) update.ciudad = ciudad ?? null;
    if (provincia !== undefined) update.provincia = provincia ?? null;
    if (activo !== undefined) update.activo = asBool(activo);

    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'sin_cambios' });
    if ('id_cliente' in req.body) return res.status(400).json({ error: 'id_no_editable' });

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
    } catch (_) { }

    res.json(r.value);
});

// Alta de siniestro con doble write (Mongo -> Neo4j)
app.post('/siniestros', async (req, res) => {
    const { nro_poliza, tipo, descripcion, monto_estimado, fecha } = req.body || {};
    if (!nro_poliza || !tipo) {
        return res.status(400).json({ error: 'nro_poliza y tipo son obligatorios' });
    }

    const poliza = await db.collection('polizas').findOne({ nro_poliza: String(nro_poliza) });
    if (!poliza) return res.status(400).json({ error: 'poliza_inexistente' });

    const estadoPoliza = String(poliza.estado || '').trim().toUpperCase();
    if (!['ACTIVA', 'SUSPENDIDA', 'VIGENTE'].includes(estadoPoliza)) {
        return res.status(400).json({ error: 'poliza_no_habilitada' });
    }

    const hoy = new Date();
    const doc = {
        id_siniestro: await db.collection('siniestros').countDocuments() + 9001, // simple correlativo local
        nro_poliza: String(nro_poliza),
        fecha: fecha ?? `${hoy.getDate()}/${hoy.getMonth() + 1}/${hoy.getFullYear()}`, // dd/m/yyyy
        tipo: String(tipo),
        monto_estimado: monto_estimado != null ? Number(monto_estimado) : null,
        descripcion: descripcion ?? null,
        estado: 'Abierto'
    };
    const r = await db.collection('siniestros').insertOne(doc);

    const s = neo4jSession();
    try {
        await s.run(
            `
      MERGE (p:Poliza {id:$pid})
      MERGE (s:Siniestro {id:$sid})
      ON CREATE SET s.id_siniestro=$id_sin, s.tipo=$tipo, s.estado='ABIERTO',
                    s.fecha=date($fecha_iso), s.monto=toFloat($monto), s.descripcion=$desc
      ON MATCH  SET s.tipo=$tipo, s.estado='ABIERTO',
                    s.fecha=coalesce(s.fecha,date($fecha_iso)),
                    s.monto=coalesce(s.monto,toFloat($monto)),
                    s.descripcion=coalesce(s.descripcion,$desc)
      MERGE (p)-[:TIENE]->(s)
      `,
            {
                pid: String(nro_poliza),
                sid: String(r.insertedId),
                id_sin: doc.id_siniestro,
                tipo: doc.tipo,
                fecha_iso: formatDateToISO(doc.fecha),
                monto: doc.monto_estimado,
                desc: doc.descripcion
            }
        );
    } catch (e) {
        await db.collection('siniestros').updateOne({ _id: r.insertedId }, { $set: { _neo4j_sync_error: true } });
        return res.status(500).json({ error: 'neo4j_write_failed' });
    } finally {
        await s.close();
    }

    res.status(201).json({ _id: r.insertedId, ...doc });
});

// 3) Vehículos asegurados con su cliente y póliza
app.get('/vehiculos/asegurados', async (req, res) => {
    const now = new Date();
    const cur = db.collection('vehiculos').aggregate([
        { $addFields: { asegurado_norm: { $in: [{ $toLower: { $toString: "$asegurado" } }, ["true", "1", "yes", "y", "t", "si", "sí"]] } } },
        { $match: { asegurado_norm: true } },
        { $lookup: { from: 'clientes', localField: 'id_cliente', foreignField: 'id_cliente', as: 'cli' } },
        { $unwind: { path: '$cli', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'polizas',
                let: { cid: '$id_cliente' },
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
                    { $match: { estado_norm: { $in: ["ACTIVA", "VIGENTE"] }, _fi: { $lte: now }, _ff: { $gte: now } } },
                    { $project: { _id: 0, nro_poliza: 1, tipo: 1, fecha_inicio: { $dateToString: { date: "$_fi", format: "%Y-%m-%d" } }, fecha_fin: { $dateToString: { date: "$_ff", format: "%Y-%m-%d" } } } }
                ],
                as: 'polizas_vigentes'
            }
        },
        {
            $project: {
                _id: 0, patente: 1, marca: 1, modelo: 1,
                cliente: { id: '$cli.id_cliente', nombre: '$cli.nombre', apellido: '$cli.apellido' },
                polizas: '$polizas_vigentes'
            }
        }
        ,
        { $group: {
            _id: '$patente',
            patente: { $first: '$patente' },
            marca: { $first: '$marca' },
            modelo: { $first: '$modelo' },
            cliente: { $first: '$cliente' },
            polizas: { $first: '$polizas' }
        } },
        { $project: { _id: 0, marca: 1, modelo: 1, patente: 1, cliente: 1, polizas: 1 } }
    ]);
    res.json(await cur.toArray());
});

// 4) Clientes sin pólizas activas
app.get('/clientes/sin-polizas-activas', async (req, res) => {
    const now = new Date();
    const cur = db.collection('clientes').aggregate([
        { $addFields: { activo_norm: { $in: [{ $toLower: { $toString: "$activo" } }, ["true", "1", "yes", "y", "t", "si", "sí"]] } } },
        { $match: { activo_norm: true } },
        {
            $lookup: {
                from: 'polizas',
                let: { cid: '$id_cliente' },
                pipeline: [
                    { $match: { $expr: { $eq: ["$id_cliente", "$$cid"] } } },
                    {
                        $addFields: {
                            _fi: { $cond: [{ $eq: [{ $type: "$fecha_inicio" }, "string"] }, { $let: { vars: { p: { $split: ["$fecha_inicio", "/"] } }, in: { $dateFromParts: { year: { $toInt: { $arrayElemAt: ["$$p", 2] } }, month: { $toInt: { $arrayElemAt: ["$$p", 1] } }, day: { $toInt: { $arrayElemAt: ["$$p", 0] } } } } } }, "$fecha_inicio"] },
                            _ff: { $cond: [{ $eq: [{ $type: "$fecha_fin" }, "string"] }, { $let: { vars: { p: { $split: ["$fecha_fin", "/"] } }, in: { $dateFromParts: { year: { $toInt: { $arrayElemAt: ["$$p", 2] } }, month: { $toInt: { $arrayElemAt: ["$$p", 1] } }, day: { $toInt: { $arrayElemAt: ["$$p", 0] } } } } } }, "$fecha_fin"] },
                            estado_norm: { $toUpper: "$estado" }
                        }
                    },
                    { $match: { estado_norm: { $in: ["ACTIVA", "VIGENTE"] }, _fi: { $lte: now }, _ff: { $gte: now } } },
                    { $limit: 1 }
                ],
                as: 'p_ok'
            }
        },
        { $match: { p_ok: { $size: 0 } } },
        { $project: { _id: 0, id_cliente: 1, nombre: 1, apellido: 1 } }
    ]);
    res.json(await cur.toArray());
});

// 5) Agentes activos con cantidad de pólizas asignadas
app.get('/agentes/activos-con-cant-polizas', async (req, res) => {
    const cur = db.collection('agentes').aggregate([
        { $addFields: { activo_norm: { $in: [{ $toLower: { $toString: "$activo" } }, ["true", "1", "yes", "y", "t", "si", "sí"]] } } },
        { $match: { activo_norm: true } },
        { $lookup: { from: 'polizas', localField: 'id_agente', foreignField: 'id_agente', as: 'p' } },
        { $project: { _id: 0, id_agente: 1, nombre: 1, cant_polizas: { $size: '$p' } } },
        { $group: { _id: '$id_agente', id_agente: { $first: '$id_agente' }, nombre: { $first: '$nombre' }, cant_polizas: { $first: '$cant_polizas' } } },
        { $project: { _id: 0, id_agente: 1, nombre: 1, cant_polizas: 1 } },
        { $sort: { cant_polizas: -1, id_agente: 1 } }
    ]);
    res.json(await cur.toArray());
});

// 6) Pólizas vencidas con nombre del cliente
app.get('/polizas/vencidas-con-cliente', async (req, res) => {
    const now = new Date();
    const cur = db.collection('polizas').aggregate([
        {
            $addFields: {
                _ff: { $cond: [{ $eq: [{ $type: "$fecha_fin" }, "string"] }, { $let: { vars: { p: { $split: ["$fecha_fin", "/"] } }, in: { $dateFromParts: { year: { $toInt: { $arrayElemAt: ["$$p", 2] } }, month: { $toInt: { $arrayElemAt: ["$$p", 1] } }, day: { $toInt: { $arrayElemAt: ["$$p", 0] } } } } } }, "$fecha_fin"] },
                estado_norm: { $toUpper: "$estado" }
            }
        },
        { $match: { $or: [{ estado_norm: "VENCIDA" }, { _ff: { $lt: now } }] } },
        { $lookup: { from: 'clientes', localField: 'id_cliente', foreignField: 'id_cliente', as: 'c' } },
        { $unwind: '$c' },
        {
            $project: {
                _id: 0, nro_poliza: 1, tipo: 1,
                fecha_fin: { $dateToString: { date: "$_ff", format: "%Y-%m-%d" } },
                cliente: { id: '$c.id_cliente', nombre: '$c.nombre', apellido: '$c.apellido' }
            }
        },
        { $group: { _id: '$nro_poliza', nro_poliza: { $first: '$nro_poliza' }, tipo: { $first: '$tipo' }, fecha_fin: { $first: '$fecha_fin' }, cliente: { $first: '$cliente' } } },
        { $project: { _id: 0, nro_poliza: 1, tipo: 1, fecha_fin: 1, cliente: 1 } },
        { $sort: { fecha_fin: -1 } }
    ]);
    res.json(await cur.toArray());
});

// 7) Top 10 clientes por cobertura total (suma de sus pólizas)
app.get('/clientes/top-cobertura', async (req, res) => {
    const cur = db.collection('polizas').aggregate([
        {
            $group: {
                _id: '$id_cliente',
                cobertura_total: { $sum: { $toDouble: '$cobertura_total' } }
            }
        },
        { $sort: { cobertura_total: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'clientes', localField: '_id', foreignField: 'id_cliente', as: 'c' } },
        { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                _id: 0,
                id_cliente: '$_id',
                nombre: '$c.nombre',
                apellido: '$c.apellido',
                cobertura_total: 1
            }
        }
        ,
        { $group: { _id: '$id_cliente', id_cliente: { $first: '$id_cliente' }, nombre: { $first: '$nombre' }, apellido: { $first: '$apellido' }, cobertura_total: { $first: '$cobertura_total' } } },
        { $project: { _id: 0, id_cliente: 1, nombre: 1, apellido: 1, cobertura_total: 1 } }
    ]);
    res.json(await cur.toArray());
});

// 8) Siniestros tipo “Accidente” del último año (Neo4j)
app.get('/siniestros/accidente-ultimo-anio', async (req, res) => {
    const s = neo4jSession();
    try {
        const r = await s.run(
            `
      WITH date() AS hoy, date() - duration('P1Y') AS desde
      MATCH (c:Cliente)-[:TIENE]->(p:Poliza)-[:TIENE]->(s:Siniestro)
      WHERE toUpper(s.tipo) = 'ACCIDENTE' AND s.fecha >= desde
      RETURN c.id AS cliente_id, p.id AS poliza_id, s.id AS siniestro_id, s.fecha AS fecha
      ORDER BY s.fecha DESC, s.id
      LIMIT 200
      `
        );
        res.json(r.records.map(x => {
            const o = x.toObject();
            o.fecha = asISO(o.fecha);
            return o;
        }));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'neo4j_query_failed' });
    } finally { await s.close(); }
});

// 9) Pólizas activas ordenadas por fecha de inicio
app.get('/polizas/activas-ordenadas', async (req, res) => {
    const now = new Date();
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize || '25', 10)));
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const skip = (page - 1) * pageSize;

    const base = [
        {
            $addFields: {
                _fi: { $cond: [{ $eq: [{ $type: "$fecha_inicio" }, "string"] }, { $let: { vars: { p: { $split: ["$fecha_inicio", "/"] } }, in: { $dateFromParts: { year: { $toInt: { $arrayElemAt: ["$$p", 2] } }, month: { $toInt: { $arrayElemAt: ["$$p", 1] } }, day: { $toInt: { $arrayElemAt: ["$$p", 0] } } } } } }, "$fecha_inicio"] },
                _ff: { $cond: [{ $eq: [{ $type: "$fecha_fin" }, "string"] }, { $let: { vars: { p: { $split: ["$fecha_fin", "/"] } }, in: { $dateFromParts: { year: { $toInt: { $arrayElemAt: ["$$p", 2] } }, month: { $toInt: { $arrayElemAt: ["$$p", 1] } }, day: { $toInt: { $arrayElemAt: ["$$p", 0] } } } } } }, "$fecha_fin"] },
                estado_norm: { $toUpper: "$estado" }
            }
        },
        { $match: { estado_norm: { $in: ["ACTIVA", "VIGENTE"] }, _fi: { $lte: now }, _ff: { $gte: now } } }
    ];

    const [items, total] = await Promise.all([
        db.collection('polizas').aggregate([...base, { $sort: { _fi: 1, nro_poliza: 1 } }, { $skip: skip }, { $limit: pageSize },
        { $project: { _id: 0, nro_poliza: 1, tipo: 1, fecha_inicio: { $dateToString: { date: "$_fi", format: "%Y-%m-%d" } }, fecha_fin: { $dateToString: { date: "$_ff", format: "%Y-%m-%d" } }, estado: '$estado_norm' } }
        ]).toArray(),
        db.collection('polizas').aggregate([...base, { $count: 'n' }]).toArray()
    ]);

    res.json({ page, pageSize, total: total[0]?.n || 0, items });
});

// 10) Pólizas suspendidas con estado del cliente
app.get('/polizas/suspendidas-con-estado-cliente', async (req, res) => {
    const cur = db.collection('polizas').aggregate([
        { $addFields: { estado_norm: { $toUpper: "$estado" } } },
        { $match: { estado_norm: 'SUSPENDIDA' } },
        { $lookup: { from: 'clientes', localField: 'id_cliente', foreignField: 'id_cliente', as: 'c' } },
        { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                _id: 0, nro_poliza: 1, tipo: 1, estado: '$estado_norm',
                cliente: {
                    id: '$c.id_cliente',
                    nombre: '$c.nombre',
                    apellido: '$c.apellido',
                    activo: '$c.activo'
                }
            }
        }
        ,
        { $group: { _id: '$nro_poliza', nro_poliza: { $first: '$nro_poliza' }, tipo: { $first: '$tipo' }, estado: { $first: '$estado' }, cliente: { $first: '$cliente' } } },
        { $project: { _id: 0, nro_poliza: 1, tipo: 1, estado: 1, cliente: 1 } }
    ]);
    res.json(await cur.toArray());
});

// 11) Clientes con más de un vehículo asegurado
app.get('/clientes/con-multiples-vehiculos', async (req, res) => {
    const cur = db.collection('vehiculos').aggregate([
        { $addFields: { asegurado_norm: { $in: [{ $toLower: { $toString: "$asegurado" } }, ["true", "1", "yes", "y", "t", "si", "sí"]] } } },
        { $match: { asegurado_norm: true } },
        { $group: { _id: '$id_cliente', cant: { $sum: 1 } } },
        { $match: { cant: { $gt: 1 } } },
        { $lookup: { from: 'clientes', localField: '_id', foreignField: 'id_cliente', as: 'c' } },
        { $unwind: { path: '$c', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, id_cliente: '$_id', nombre: '$c.nombre', apellido: '$c.apellido', cant_vehiculos: '$cant' } },
        { $sort: { cant_vehiculos: -1, id_cliente: 1 } }
    ]);
    res.json(await cur.toArray());
});

// 12) Agentes y cantidad de siniestros asociados (Neo4j)
app.get('/agentes/cant-siniestros', async (req, res) => {
    const s = neo4jSession();
    try {
        const r = await s.run(
            `
      MATCH (a:Agente)-[:GESTIONA]->(p:Poliza)-[:TIENE]->(s:Siniestro)
      RETURN a.id AS id_agente, count(s) AS cant_siniestros
      ORDER BY cant_siniestros DESC, id_agente ASC
      LIMIT 200
      `
        );
        res.json(r.records.map(x => x.toObject()));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'neo4j_query_failed' });
    } finally { await s.close(); }
});

const port = process.env.PORT;
app.listen(port, () => console.log(`API :${port}`));
