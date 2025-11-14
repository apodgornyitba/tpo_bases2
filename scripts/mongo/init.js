const dbName = 'aseguradoras';
const db = db.getSiblingDB(dbName);

// crear colecciones si no existen
['clientes', 'agentes', 'polizas', 'siniestros', 'vehiculos'].forEach(c => {
    if (!db.getCollectionNames().includes(c)) db.createCollection(c);
});

// clientes
db.clientes.createIndex({ id_cliente: 1 });

db.polizas.createIndex({ id_cliente: 1 });
db.polizas.createIndex({ id_agente: 1 });
db.polizas.createIndex({ estado: 1 });
db.polizas.createIndex({ fecha_inicio: 1 });
db.polizas.createIndex({ fecha_fin: 1 });
db.polizas.createIndex({ key: { id_cliente: 1, nro_poliza: 1 }, unique: true });

// siniestros
db.siniestros.createIndex({ poliza_id: 1 });
db.siniestros.createIndex({ tipo: 1 });
db.siniestros.createIndex({ fecha: 1 });
db.siniestros.createIndex({ estado: 1 });

// vehiculos
db.vehiculos.createIndex({ id_cliente: 1 });
db.vehiculos.createIndex({ asegurado: 1 });
db.vehiculos.createIndex({ patente: 1 }, { unique: true });
