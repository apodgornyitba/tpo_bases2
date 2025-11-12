import express from 'express';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from './ensure-indexes.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/aseguradoras';
const app = express();
app.use(express.json());

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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API :${port}`));
