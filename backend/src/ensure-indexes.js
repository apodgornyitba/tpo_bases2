export async function ensureIndexes(db) {
  await db.collection('clientes').createIndex({ id_cliente: 1 });
  await db.collection('polizas').createIndexes([
    { key: { id_cliente: 1 } },
    { key: { id_agente: 1 } },
    { key: { estado: 1 } },
    { key: { fecha_inicio: 1 } },
    { key: { fecha_fin: 1 } }
  ]);
  await db.collection('siniestros').createIndexes([
    { key: { poliza_id: 1 } },
    { key: { tipo: 1 } },
    { key: { fecha: 1 } },
    { key: { estado: 1 } }
  ]);
  await db.collection('vehiculos').createIndexes([
    { key: { id_cliente: 1 } },
    { key: { asegurado: 1 } },
    { key: { patente: 1 }, unique: true }
  ]);
}
