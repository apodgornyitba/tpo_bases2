const dbName = 'aseguradoras';
const db = db.getSiblingDB(dbName);

['clientes','agentes','polizas','siniestros','vehiculos'].forEach(c => {
  if (!db.getCollectionNames().includes(c)) db.createCollection(c);
});

db.polizas.createIndex({cliente_id:1});
db.polizas.createIndex({agente_id:1});
db.polizas.createIndex({estado:1});
db.polizas.createIndex({fecha_inicio:1});
db.polizas.createIndex({fecha_fin:1});

db.siniestros.createIndex({poliza_id:1});
db.siniestros.createIndex({tipo:1});
db.siniestros.createIndex({fecha:1});
db.siniestros.createIndex({estado:1});

db.vehiculos.createIndex({cliente_id:1});
db.vehiculos.createIndex({asegurado:1});
db.vehiculos.createIndex({patente:1}, {unique:true});